"""Isolated, read-only adapter around Crawl4AI 0.9.2 and its unmodified egress broker.

Only URL and public reading goal are accepted. No LLM extraction, credentials,
arbitrary JS, caller proxy, TLS bypass, persistent browser profile or project data.
"""
import asyncio
import base64
import hashlib
import io
import importlib.metadata
import json
import os
import re
from pathlib import Path
import sys
import time
from urllib.parse import quote, unquote, urlsplit, urlunsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread, Lock
from PIL import Image

os.environ['CRAWL4AI_ALLOW_INTERNAL_URLS'] = 'false'
os.environ['CRAWL4AI_ALLOW_INSECURE_TLS'] = 'false'
os.environ['ANONYMIZED_TELEMETRY'] = 'false'
sys.path.insert(0, str(Path(__file__).parent / 'crawl4ai-upstream'))
from egress_broker import enforce_egress, set_egress_proxy
import httpx
from pypdf import PdfReader
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator
from crawl4ai.content_filter_strategy import PruningContentFilter
from crawl4ai.deep_crawling.scorers import KeywordRelevanceScorer
import crawl4ai
import pypdf

AUDIT = Path(__file__).with_suffix('.audit.jsonl')
LOOP = asyncio.new_event_loop()
READY = False
CRAWLER = None
PROXY = None
GATE = None
STOP = None
OCR = None
OCR_LOCK = Lock()
LOADED_WRAPPER = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def fingerprint():
    files = []
    for package in (crawl4ai, pypdf):
        base = Path(package.__file__).parent
        files.extend((package.__name__+'/'+str(p.relative_to(base)), p.read_bytes())
                     for p in sorted(base.rglob('*.py')))
    base = Path(__file__).parent / 'crawl4ai-upstream'
    files.extend((p.name, p.read_bytes()) for p in sorted(base.glob('*.py')))
    import rapidocr
    ocr_base = Path(rapidocr.__file__).parent
    files.extend(('rapidocr/'+str(p.relative_to(ocr_base)), p.read_bytes())
                 for p in sorted(ocr_base.rglob('*')) if p.suffix in ('.py', '.onnx', '.yaml', '.txt'))
    digest = hashlib.sha256()
    for name, raw in files:
        digest.update(name.encode())
        digest.update(raw)
    versions = sorted((d.metadata['Name'], d.version) for d in importlib.metadata.distributions())
    return {'source_sha256': digest.hexdigest(), 'source_files': len(files),
            'distribution_sha256': hashlib.sha256(json.dumps(versions).encode()).hexdigest(),
            'crawl4ai': importlib.metadata.version('crawl4ai'),
            'pypdf': importlib.metadata.version('pypdf'), 'python': sys.version.split()[0],
            'rapidocr': importlib.metadata.version('rapidocr'),
            'loaded_wrapper_sha256': LOADED_WRAPPER,
            'wrapper_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}


def canonical(value):
    p = urlsplit(value)
    if p.scheme not in ('https', 'http') or not p.hostname or p.username or p.password:
        raise ValueError('Only credential-free public HTTP(S) URLs')
    return urlunsplit((p.scheme, p.netloc, quote(p.path or '/', safe="/%:@!$&'()*+,;=-._~"), p.query, ''))


async def pdf(url):
    # The upstream pinning proxy validates every connect/redirect; httpx keeps TLS on.
    async with httpx.AsyncClient(proxy=PROXY, verify=True, trust_env=False,
                                 follow_redirects=True, timeout=25) as client:
        async with client.stream('GET', url) as response:
            response.raise_for_status()
            chunks, count = [], 0
            async for chunk in response.aiter_bytes():
                count += len(chunk)
                if count > 10 * 1024 * 1024:
                    raise ValueError('PDF exceeds 10 MiB')
                chunks.append(chunk)
            raw = b''.join(chunks)
            if not raw.startswith(b'%PDF'):
                return None
            final = str(response.url)
    reader = PdfReader(io.BytesIO(raw))
    if len(reader.pages) > 60:
        raise ValueError('PDF exceeds 60 pages')
    pages = [{'page': i+1, 'text': (page.extract_text() or '')}
             for i, page in enumerate(reader.pages)]
    text = '\n\n'.join('## PDF page '+str(p['page'])+'\n'+p['text'] for p in pages)
    return {'success': True, 'url': final, 'title': final.rsplit('/', 1)[-1],
            'text': text[:24000], 'body_chars': len(text), 'links': [],
            'media_type': 'application/pdf', 'pages': len(pages),
            'original_sha256': hashlib.sha256(raw).hexdigest(), 'reader': 'pypdf'}


async def read(url, goal):
    async with GATE:
        started = time.monotonic()
        url = canonical(url)
        result = None
        if urlsplit(url).path.lower().endswith(('.pdf', '.ashx')):
            result = await pdf(url)
        if result is None:
            config = CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS, page_timeout=25000,
                wait_until='domcontentloaded', delay_before_return_html=0.7,
                word_count_threshold=3, process_iframes=False,
                remove_overlay_elements=False,
                # Keep real navigation links for source discovery; the mature
                # pruning filter handles body selection after link extraction.
                excluded_tags=['script', 'style', 'form', 'svg'],
                excluded_selector='#onetrust-consent-sdk,#CybotCookiebotDialog',
                markdown_generator=DefaultMarkdownGenerator(
                    content_filter=PruningContentFilter(threshold=0.45),
                    options={'ignore_links': False}),
                verbose=False,
            )
            r = await CRAWLER.arun(url=url, config=config)
            with Path(__file__).with_suffix('.sdk-debug.jsonl').open('a', encoding='utf-8') as f:
                f.write(json.dumps({'url': url, 'success': r.success, 'error': r.error_message,
                                    'html': r.html, 'markdown': str(r.markdown), 'links': r.links},
                                   ensure_ascii=False)+'\n')
            if not r.success or (r.status_code or 0) >= 400:
                return {'error': 'crawl4ai_failed', 'url': url, 'http_status': r.status_code,
                        'final_url': r.redirected_url or r.url, 'detail': r.error_message[:700]}
            final = canonical(r.redirected_url or r.url)
            markdown = r.markdown
            text = (getattr(markdown, 'fit_markdown', '') or '').strip()
            if len(text) < 160:
                text = (getattr(markdown, 'raw_markdown', '') or '').strip()
            links, seen = [], set()
            for group in ('internal', 'external'):
                for link in (r.links or {}).get(group, []):
                    try:
                        dest = canonical(link.get('href', ''))
                    except (ValueError, TypeError):
                        continue
                    if dest not in seen and dest != final:
                        seen.add(dest)
                        links.append({'url': dest, 'title': link.get('text', '')[:200]})
            scorer = KeywordRelevanceScorer(keywords=list(set(
                re.findall(r'[a-z]{4,}', goal.lower()) +
                ['installation', 'download', 'manual', 'technical', 'heating', 'instructions',
                 '安装', '安裝', '地暖', '地熱', '地热', '中文', 'zh-cn', 'zh-tw', 'cn.'])))
            # Include actual anchor text and decoded URL in the SDK scorer.
            # Encoded Chinese paths otherwise all score zero. No invented URLs.
            links.sort(key=lambda item: scorer.score(unquote(item['url'])+' '+item['title']), reverse=True)
            result = {'success': True, 'url': final,
                      'title': (r.metadata or {}).get('title') or final, 'http_status': r.status_code,
                      'text': text[:24000], 'body_chars': len(text), 'links': links[:100],
                      'media_type': 'text/html', 'reader': 'Crawl4AI 0.9.2'}
        result['sha256'] = hashlib.sha256(result['text'].encode()).hexdigest()
        result['elapsed_ms'] = round((time.monotonic()-started)*1000)
        result['tls_verification'] = True
        result['egress'] = 'upstream-v0.9.2-resolve-and-pin-proxy'
        return result


def ocr(image):
    """Local text recognition, with no measurement semantics inferred from shape."""
    global OCR
    if not isinstance(image, str) or not re.fullmatch(r'data:image/(?:png|jpeg);base64,[A-Za-z0-9+/=]+', image):
        raise ValueError('Only inline PNG/JPEG pixels are accepted')
    raw = base64.b64decode(image.split(',', 1)[1], validate=True)
    if len(raw) > 3*1024*1024:
        raise ValueError('Image exceeds 3 MiB')
    with Image.open(io.BytesIO(raw)) as im:
        width, height = im.size
        if width*height > 12_000_000:
            raise ValueError('Image exceeds pixel budget')
    with OCR_LOCK:
        if OCR is None:
            from rapidocr import RapidOCR
            OCR = RapidOCR()
        output = OCR(raw)
    labels, dimensions = [], []
    for box, text, confidence in zip(output.boxes if output.boxes is not None else [],
                                     output.txts or [], output.scores or []):
        label = {'text': text, 'confidence': round(float(confidence), 4),
                 'box': [[round(float(x), 1), round(float(y), 1)] for x, y in box]}
        labels.append(label)
        if confidence < 0.85:
            continue
        for match in re.finditer(r'(?<!\d)(\d+(?:\.\d+)?)\s*(mm|cm|毫米|厘米|米|m)(?![A-Za-z])', text, re.I):
            # A number alone never determines net/axis/finished size. The type
            # must be explicit in the SAME recognized dimension label.
            kind = 'net' if re.search(r'净|淨|net|clear', text, re.I) else 'axis' if re.search(r'轴|軸|axis', text, re.I) else 'unspecified'
            dimensions.append({'literal_label': text, 'value': float(match.group(1)),
                               'unit': match.group(2), 'dimension_type': kind,
                               'box': label['box'], 'confidence': label['confidence']})
    return {'reader': 'RapidOCR '+importlib.metadata.version('rapidocr'),
            'image_sha256': hashlib.sha256(raw).hexdigest(), 'image_size': [width, height],
            'labels': labels[:80], 'dimensions': dimensions,
            'status': 'ocr_support_only_original_pixels_still_required'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == '/health':
            return self.reply(200 if READY else 503,
                              {'ready': READY, 'reader': 'crawl4ai-0.9.2', 'pid': os.getpid(),
                               'fingerprint': fingerprint()})
        self.reply(404, {'error': 'not_found'})

    def do_POST(self):
        if (self.headers.get('Host') not in ('127.0.0.1:18094', 'localhost:18094')
                or self.headers.get('Origin')
                or self.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
            return self.reply(404, {'error': 'not_found'})
        if self.path == '/shutdown':
            self.reply(200, {'stopping': True})
            LOOP.call_soon_threadsafe(STOP.set)
            return
        if self.path == '/ocr':
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not READY or not 0 < length <= 4_300_000:
                    raise ValueError('Invalid OCR input size')
                body = json.loads(self.rfile.read(length))
                if set(body) != {'image'}:
                    raise ValueError('Only inline image is accepted')
                result = ocr(body['image'])
                with AUDIT.open('a', encoding='utf-8') as f:
                    f.write(json.dumps({'type': 'ocr', 'result': result}, ensure_ascii=False)+'\n')
                return self.reply(200, result)
            except Exception as exc:
                return self.reply(422, {'error': type(exc).__name__, 'detail': str(exc)[:300]})
        if self.path != '/read':
            return self.reply(404, {'error': 'not_found'})
        row = {'started': time.time()}
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not READY or not 0 < length <= 6000:
                raise ValueError('Invalid request or reader not ready')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or set(body) - {'url', 'goal'}:
                raise ValueError('Only public URL and goal are accepted')
            url, goal = body.get('url', ''), body.get('goal', '')
            if not isinstance(url, str) or not isinstance(goal, str) or len(url) > 4000 or len(goal) > 1000:
                raise ValueError('Invalid public input')
            row.update(url=url, goal=goal)
            task = asyncio.run_coroutine_threadsafe(asyncio.wait_for(read(url, goal), 45), LOOP)
            result = task.result(timeout=48)
            row['result'] = result
            self.reply(200, result)
        except Exception as exc:
            row['error'] = type(exc).__name__+': '+str(exc)[:500]
            self.reply(422, {'error': type(exc).__name__, 'detail': str(exc)[:500]})
        finally:
            with AUDIT.open('a', encoding='utf-8') as f:
                f.write(json.dumps(row, ensure_ascii=False)+'\n')


async def main():
    global CRAWLER, PROXY, GATE, READY, STOP
    # Keep OS proxy DNS/fake-IP outside the fetch path. The unmodified upstream
    # broker runs in the approved remote Docker network and pins every connect.
    PROXY = 'http://127.0.0.1:18097'
    set_egress_proxy(PROXY)
    GATE = asyncio.Semaphore(1)
    STOP = asyncio.Event()
    config = BrowserConfig(browser_type='chromium', channel='chrome', chrome_channel='chrome',
                           headless=True, ignore_https_errors=False, verbose=False,
                           extra_args=['--disable-quic'])
    enforce_egress(config)
    assert not config.ignore_https_errors and config.proxy_config.server == PROXY
    CRAWLER = AsyncWebCrawler(config=config)
    # SDK0.9.2 adds certificate-ignore flags inside BrowserManager even with
    # ignore_https_errors=False. Filter the effective launch config, without
    # changing package sources, then verify it using an invalid-certificate URL.
    manager = CRAWLER.crawler_strategy.browser_manager
    original_launch = manager._build_browser_args
    def verified_launch():
        launch = original_launch()
        launch['args'] = [a for a in launch.get('args', []) if not str(a).startswith(
            ('--ignore-certificate-errors', '--allow-insecure-localhost',
             '--disable-web-security', '--no-sandbox'))]
        launch['chromium_sandbox'] = True
        return launch
    manager._build_browser_args = verified_launch
    try:
        await CRAWLER.start()
        READY = True
        print(json.dumps({'ready': True, 'pid': os.getpid(), 'tls_verification': True}), flush=True)
        await STOP.wait()
    finally:
        READY = False
        await CRAWLER.close()


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 18094), Handler)
    server.daemon_threads = True
    Thread(target=server.serve_forever, daemon=True).start()
    asyncio.set_event_loop(LOOP)
    try:
        LOOP.run_until_complete(main())
    finally:
        server.shutdown()
