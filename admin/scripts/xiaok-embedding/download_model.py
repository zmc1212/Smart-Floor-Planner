"""Download only the pinned official snapshot and verify LFS SHA256 digests."""
import hashlib
import json
from pathlib import Path
from huggingface_hub import HfApi
import requests
from concurrent.futures import ThreadPoolExecutor

MODEL = "Qwen/Qwen3-Embedding-0.6B"
REVISION = "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3"
root = Path(__file__).resolve().parent
target = root / "model" / REVISION
info = HfApi(endpoint="https://huggingface.co").model_info(MODEL, revision=REVISION, files_metadata=True)
assert info.sha == REVISION
manifest = {}
for entry in info.siblings:
    if not entry.rfilename.endswith((".json", ".safetensors", ".txt", ".model")) and entry.rfilename not in ("README.md", "LICENSE"):
        continue
    path = target / entry.rfilename
    path.parent.mkdir(parents=True, exist_ok=True)
    def valid():
        if not path.is_file():
            return False
        if entry.lfs:
            with path.open("rb") as stream:
                return hashlib.file_digest(stream, "sha256").hexdigest() == entry.lfs.sha256
        content = path.read_bytes()
        return hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest() == entry.blob_id
    if not valid():
        sources = [f"https://hf-mirror.com/{MODEL}/resolve/{REVISION}/{entry.rfilename}?download=true",
                   f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{entry.rfilename}?download=true"]
        if entry.lfs:
            # ModelScope is transport only. Accept master bytes only if they match the pinned official SHA256.
            sources.insert(0, f"https://modelscope.cn/models/{MODEL}/resolve/master/{entry.rfilename}?xiaok={REVISION}")
        for url in sources:
            endpoint = url.split('/')[2]
            try:
                if entry.lfs:
                    size = entry.lfs.size
                    chunk_size = 8 * 1024 * 1024
                    def part(start):
                        end = min(start + chunk_size, size) - 1
                        with requests.get(url + f"&part={start}", headers={"Range": f"bytes={start}-{end}"}, timeout=(20, 30)) as response:
                            response.raise_for_status()
                            if response.status_code != 206 or len(response.content) != end - start + 1:
                                raise RuntimeError("invalid_range_response")
                            return response.content
                    with ThreadPoolExecutor(max_workers=4) as pool, path.open("wb") as stream:
                        for index, block in enumerate(pool.map(part, range(0, size, chunk_size))):
                            stream.write(block)
                            if index % 16 == 0:
                                print("DOWNLOAD_BYTES", stream.tell(), size, endpoint, flush=True)
                else:
                    with requests.get(url, stream=True, timeout=(20, 30)) as response:
                        response.raise_for_status()
                        with path.open("wb") as stream:
                            for block in response.iter_content(1024 * 1024):
                                stream.write(block)
                if not valid():
                    raise RuntimeError("checksum_mismatch")
                print("DOWNLOADED", entry.rfilename, endpoint, flush=True)
                break
            except Exception as error:
                print("DOWNLOAD_RETRY", entry.rfilename, endpoint, type(error).__name__, flush=True)
        if not valid():
            raise RuntimeError("Verified download unavailable: " + entry.rfilename)
    digest = hashlib.file_digest(path.open("rb"), "sha256").hexdigest()
    if entry.lfs and digest != entry.lfs.sha256:
        raise RuntimeError("Official LFS checksum mismatch: " + entry.rfilename)
    manifest[entry.rfilename] = {"sha256": digest, "bytes": path.stat().st_size}
(root / "model-manifest.json").write_text(json.dumps({"model": MODEL, "revision": REVISION, "files": manifest}, indent=2), encoding="utf-8")
print("MODEL_VERIFIED", REVISION, len(manifest))
