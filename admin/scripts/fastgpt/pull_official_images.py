"""Verified official-registry image transport when Docker Desktop proxy stalls.

Uses the Windows host's direct HTTPS path, verifies every registry blob digest,
and hands a standard Docker archive to the existing engine. No daemon/proxy
configuration or existing container is changed. Python standard library only.
"""
import concurrent.futures
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path('D:/Smart-Floor-Planner-Dev/fastgpt-pilot').resolve()
CACHE = ROOT / 'image-cache'
CACHE.mkdir(exist_ok=True)
REGISTRY = 'registry.cn-hangzhou.aliyuncs.com'
IMAGES = [
    ('fastgpt/mongo', '5.0.32'),
    ('fastgpt/redis', '7.2-alpine'),
    ('fastgpt/minio', 'RELEASE.2025-09-07T16-13-09Z'),
    ('labring/aiproxy', 'v0.7.7'),
    ('fastgpt/fastgpt-code-sandbox', 'v5.0.0'),
    ('fastgpt/fastgpt', 'v4.17.4'),
    ('fastgpt/fastgpt-plugin', 'v1.2.0'),
]
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
ACCEPT = ', '.join(['application/vnd.oci.image.index.v1+json',
                    'application/vnd.oci.image.manifest.v1+json',
                    'application/vnd.docker.distribution.manifest.v2+json'])


def request(url, headers=None):
    return HTTP.open(urllib.request.Request(url, headers=headers or {}), timeout=40)


def image(repository, tag):
    url = f'https://{REGISTRY}/v2/{repository}'
    try:
        request(url + '/manifests/' + tag, {'Accept': ACCEPT}).close()
        headers = {'Accept': ACCEPT}
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise
        auth = dict(re.findall(r'(\w+)="([^"]+)"', error.headers['WWW-Authenticate']))
        query = urllib.parse.urlencode({'service': auth['service'], 'scope': auth['scope']})
        with request(auth['realm'] + '?' + query) as response:
            token = json.load(response)['token']
        headers = {'Accept': ACCEPT, 'Authorization': 'Bearer ' + token}
    with request(url + '/manifests/' + tag, headers) as response:
        manifest_bytes = response.read()
    manifest = json.loads(manifest_bytes)
    if 'manifests' in manifest:
        digest = next(m['digest'] for m in manifest['manifests']
                      if m.get('platform', {}).get('architecture') == 'amd64'
                      and m.get('platform', {}).get('os') == 'linux')
        with request(url + '/manifests/' + digest, headers) as response:
            manifest_bytes = response.read()
        if 'sha256:' + hashlib.sha256(manifest_bytes).hexdigest() != digest:
            raise RuntimeError('Manifest digest mismatch')
        manifest = json.loads(manifest_bytes)
    if sum(m['size'] for m in manifest['layers']) > 2 * 1024**3:
        raise RuntimeError('Unexpectedly large pilot image')

    def blob(descriptor):
        digest = descriptor['digest']
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
            raise RuntimeError('Unsupported blob digest')
        target = CACHE / (digest[7:] + '.blob')
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == digest[7:]:
            return target
        temporary = target.with_suffix('.partial')
        # Aliyun's large un-ranged downloads can stall on this host; bounded
        # HTTP byte ranges use the same signed official blob and remain verified
        # against its registry digest after assembly.
        size = descriptor['size']
        chunk_size = 1024 * 1024

        def part(start):
            end = min(start + chunk_size, size) - 1
            ranged = {**headers, 'Range': f'bytes={start}-{end}'}
            deadline = time.monotonic() + 60
            with request(url + '/blobs/' + digest, ranged) as source:
                if source.status != 206 and not (source.status == 200 and start == 0 and end == size - 1):
                    raise RuntimeError('Registry did not honor the bounded byte range')
                chunks, remaining = [], end - start + 1
                while remaining:
                    if time.monotonic() > deadline:
                        raise TimeoutError('Registry byte-range deadline exceeded')
                    data = source.read1(min(65536, remaining))
                    if not data:
                        raise RuntimeError('Incomplete registry byte range')
                    chunks.append(data)
                    remaining -= len(data)
            return b''.join(chunks)

        # Bounded parallel public-blob ranges avoid the observed ~120KB/s per
        # connection bottleneck. No registry rate-limit responses are retried.
        with temporary.open('wb') as output, concurrent.futures.ThreadPoolExecutor(max_workers=8) as ranges:
            for number, chunk in enumerate(ranges.map(part, range(0, size, chunk_size)), 1):
                output.write(chunk)
                if number % 32 == 0:
                    print(f'{repository} blob {digest[7:19]}: {number} MiB received', flush=True)
        with temporary.open('rb') as source:
            actual = hashlib.file_digest(source, 'sha256').hexdigest()
        if actual != digest[7:]:
            raise RuntimeError('Blob digest mismatch')
        temporary.replace(target)
        return target

    descriptors = [manifest['config'], *manifest['layers']]
    print(f'Downloading {repository}:{tag}: {len(manifest["layers"])} layers', flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        files = list(pool.map(blob, descriptors))
    config_name = manifest['config']['digest'][7:] + '.json'
    layers = []
    for descriptor, compressed in zip(manifest['layers'], files[1:]):
        name = descriptor['digest'][7:] + '/layer.tar'
        expanded = CACHE / (descriptor['digest'][7:] + '.layer')
        if not expanded.exists():
            with compressed.open('rb') as source:
                signature = source.read(2)
            with (gzip.open(compressed, 'rb') if signature == b'\x1f\x8b' else compressed.open('rb')) as source, expanded.open('wb') as target:
                shutil.copyfileobj(source, target, 1024 * 1024)
        layers.append((name, expanded))
    archive = CACHE / (repository.replace('/', '-') + '-' + tag + '.tar')
    records = json.dumps([{'Config': config_name, 'RepoTags': [f'{REGISTRY}/{repository}:{tag}'],
                           'Layers': [name for name, _ in layers]}]).encode()
    with tarfile.open(archive, 'w') as tar:
        tar.add(files[0], arcname=config_name)
        for name, source in layers:
            tar.add(source, arcname=name)
        entry = tarfile.TarInfo('manifest.json')
        entry.size = len(records)
        tar.addfile(entry, io.BytesIO(records))
    subprocess.run(['docker', '--config', 'D:/Smart-Floor-Planner-Dev/docker-cli',
                    'image', 'load', '-i', str(archive)], check=True)
    print(f'Loaded {repository}:{tag}; verified registry manifest and blobs', flush=True)
    return {'image': f'{REGISTRY}/{repository}:{tag}',
            'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest(),
            'configSha256': manifest['config']['digest'], 'layers': len(layers)}


if __name__ == '__main__':
    record_file = ROOT / 'verified-images.json'
    results = json.loads(record_file.read_text(encoding='utf-8')) if record_file.exists() else []
    for repository, tag in IMAGES:
        image_name = f'{REGISTRY}/{repository}:{tag}'
        previous = next((r for r in results if r['image'] == image_name), None)
        if previous:
            found = subprocess.run(['docker', '--config', 'D:/Smart-Floor-Planner-Dev/docker-cli',
                                    'image', 'inspect', image_name, '--format', '{{.Id}}'], capture_output=True, text=True)
            if found.returncode == 0 and found.stdout.strip() == previous['configSha256']:
                print(f'Already verified and loaded: {image_name}', flush=True)
                continue
            raise RuntimeError('Previously verified pilot image changed')
        results.append(image(repository, tag))
        record_file.write_text(json.dumps(results, indent=2), encoding='utf-8')
