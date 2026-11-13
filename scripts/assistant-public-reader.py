"""Bounded public reader for the consultation profile; no browser or LLM.

Use Crawl4AI's maintained static scraper/markdown pipeline and pypdf, through
the same approved resolve-and-pin egress broker as the isolated comparison.
Dynamic-only pages fail explicitly rather than bypassing TLS or bot checks.
"""
import asyncio
import argparse
import base64
from collections import Counter
from email.message import Message
import hashlib
import io
import json
import os
import re
from pathlib import Path
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

MAX_BYTES = 4 * 1024 * 1024
PDF_RANGE_BYTES = 2 * 1024 * 1024
PDF_MAX_BYTES = 4 * PDF_RANGE_BYTES
PARSER = 'crawl4ai-static-0.9.2+pypdf-6.21.2-v1'
PDF_MIME = 'application/pdf'
READ_HEADERS = {'Accept': 'text/html,text/plain,application/pdf,application/octet-stream',
                'Accept-Encoding': 'identity', 'User-Agent': 'SmartFloorPlanner-Research/1.0'}


def public_url(value):
    p = urlsplit(value)
    if (p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password
            or p.port not in (None, 80 if p.scheme == 'http' else 443)):
        raise ValueError('unsafe_web_url')
    return urlunsplit((p.scheme, p.netloc, p.path or '/', p.query, ''))


def parse_pdf(raw):
    from pypdf import PdfReader
    if not raw.startswith(b'%PDF-') or len(raw) > PDF_MAX_BYTES:
        raise ValueError('invalid_pdf')
    reader = PdfReader(io.BytesIO(raw))
    if reader.is_encrypted:
        raise ValueError('encrypted_pdf')
    if not 1 <= len(reader.pages) <= 50:
        raise ValueError('pdf_page_limit')
    pages, size, repeated = [], 0, Counter()
    for index, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ''
            images = bool(page.images.keys())
            compact = ''.join(text.split())
            status = 'text' if any(c.isalnum() for c in compact) else (
                'ocr_required' if images else 'blank' if page.get('/Contents') is None else 'unreadable')
            if images and compact and len(compact) <= 120:
                repeated[compact] += 1
        except Exception:
            text, images, compact, status = '', False, '', 'unreadable'
        size += len(text.encode())
        if size > 2_000_000:
            raise ValueError('pdf_text_limit')
        pages.append({'page': index + 1, 'text': text, 'status': status, 'images': images, 'compact': compact})
    for page in pages:
        # Image-backed pages sometimes share the same short selectable overlay.
        # A repeated overlay is not coverage of the scanned body.
        if page.pop('images') and repeated[page['compact']] > 1:
            page.update(text='', status='ocr_required')
        del page['compact']
    return pages


async def isolated_pdf(raw, timeout):
    process = await asyncio.create_subprocess_exec(sys.executable, str(Path(__file__).resolve()), '--parse-pdf',
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    try:
        try:
            output, _ = await asyncio.wait_for(process.communicate(raw), timeout=min(15, timeout))
        except TimeoutError as error:
            raise ValueError('pdf_parse_timeout') from error
        if process.returncode or len(output) > 3_000_000:
            raise ValueError('pdf_parse_failed')
        result = json.loads(output)
        if isinstance(result, dict):
            raise ValueError(result.get('error', 'pdf_parse_failed'))
        return result
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


def identity_encoding(response):
    if response.headers.get('content-encoding', 'identity').lower() != 'identity':
        raise ValueError('unsupported_web_encoding')


async def bounded_body(response, limit):
    identity_encoding(response)
    chunks, size = [], 0
    async for chunk in response.aiter_raw():
        size += len(chunk)
        if size > limit:
            raise ValueError('web_download_limit')
        chunks.append(chunk)
    return b''.join(chunks)


async def read_pdf_ranges(client, url, length, etag):
    # Keep the full-response limit. Only a known-size HTTPS PDF with a strong
    # validator may be retrieved in fixed ranges under the same deadline.
    if (urlsplit(url).scheme != 'https' or not MAX_BYTES < length <= PDF_MAX_BYTES
            or not re.fullmatch(r'"[^"\s]{1,200}"', etag)):
        raise ValueError('web_download_limit')
    blocks = []
    for start in range(0, length, PDF_RANGE_BYTES):
        end = min(start + PDF_RANGE_BYTES, length) - 1
        headers = {**READ_HEADERS, 'Range': f'bytes={start}-{end}', 'If-Match': etag}
        async with client.stream('GET', url, headers=headers) as response:
            if (response.status_code != 206 or response.headers.get('etag') != etag
                    or response.headers.get('content-range') != f'bytes {start}-{end}/{length}'
                    or response.headers.get('content-type', '').split(';')[0].lower() != PDF_MIME):
                raise ValueError('pdf_range_unavailable')
            part = await bounded_body(response, end - start + 1)
            if len(part) != end - start + 1:
                raise ValueError('pdf_range_unavailable')
            blocks.append(part)
    return b''.join(blocks)


def attachment_title(disposition, url):
    header = Message()
    header['Content-Disposition'] = disposition
    name = header.get_filename() or unquote(urlsplit(url).path.rsplit('/', 1)[-1])
    return re.sub(r'[\x00-\x1f\x7f]', '', unquote(name)).strip() or urlsplit(url).hostname


async def read_public(value, remaining_ms):
    import httpx
    from crawl4ai.content_scraping_strategy import WebScrapingStrategy
    from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator
    import importlib.metadata
    if importlib.metadata.version('crawl4ai') != '0.9.2' or importlib.metadata.version('pypdf') != '6.21.2':
        raise ValueError('reader_version_changed')
    if not 1 <= remaining_ms <= 60_000:
        raise ValueError('web_deadline_exceeded')
    deadline = time.monotonic() + remaining_ms / 1000
    requested_url = url = public_url(value)
    redirects, transport = [], 'full'
    # The reviewed upstream broker rejects fake/private DNS and pins the peer;
    # the client retains certificate/hostname verification and never uses OS proxy credentials.
    async with asyncio.timeout(min(12, remaining_ms / 1000)), httpx.AsyncClient(proxy='http://127.0.0.1:18097', verify=True, trust_env=False,
                                 follow_redirects=False, timeout=min(12, remaining_ms / 1000)) as client:
        for hop in range(4):
            async with client.stream('GET', url, headers=READ_HEADERS) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    if hop == 3 or not response.headers.get('location'):
                        raise ValueError('web_redirect_limit')
                    target = public_url(urljoin(url, response.headers['location']))
                    redirects.append({'from': url, 'to': target, 'status': response.status_code})
                    url = target
                    continue
                response.raise_for_status()
                if response.status_code != 200:
                    raise ValueError('unsupported_web_response')
                identity_encoding(response)
                mime = response.headers.get('content-type', '').split(';')[0].lower()
                if mime not in (PDF_MIME, 'application/octet-stream', 'text/html', 'application/xhtml+xml', 'text/plain'):
                    raise ValueError('unsupported_web_content')
                disposition = response.headers.get('content-disposition', '')
                length = int(response.headers.get('content-length', '0'))
                if length <= MAX_BYTES:
                    raw = await bounded_body(response, MAX_BYTES)
                    break
                if mime != PDF_MIME or response.headers.get('accept-ranges', '').lower() != 'bytes':
                    raise ValueError('web_download_limit')
                etag = response.headers.get('etag', '')
            raw = await read_pdf_ranges(client, url, length, etag)
            transport = 'verified_pdf_ranges'
            break
    if time.monotonic() >= deadline:
        raise ValueError('web_deadline_exceeded')
    parse_error = None
    if mime == PDF_MIME or mime == 'application/octet-stream' and raw.startswith(b'%PDF-'):
        if not raw.startswith(b'%PDF-'):
            raise ValueError('invalid_pdf')
        title, links, mime = attachment_title(disposition, url), [], PDF_MIME
        try:
            pages = await isolated_pdf(raw, deadline - time.monotonic())
        except ValueError as error:
            pages, parse_error = [], str(error)
        if not parse_error and not any(page['status'] == 'text' for page in pages):
            parse_error = 'pdf_ocr_required' if any(p['status'] == 'ocr_required' for p in pages) else 'pdf_no_text'
    elif mime in ('text/html', 'application/xhtml+xml', 'text/plain'):
        html = raw.decode('utf-8', errors='replace')
        if re.search(r'just a moment|verify you are human|enable javascript.*cookies|access denied|验证码|安全验证', html[:4000], re.I):
            raise ValueError('web_text_unavailable')
        if mime == 'text/plain':
            pages, title, links = [{'page': 1, 'text': html}], urlsplit(url).hostname, []
        else:
            result = WebScrapingStrategy().scrap(url, html, word_count_threshold=1,
                excluded_tags=['script', 'style', 'form', 'svg', 'noscript'], process_iframes=False)
            if not result.success:
                raise ValueError('web_text_unavailable')
            markdown = DefaultMarkdownGenerator().generate_markdown(result.cleaned_html, base_url=url, citations=False)
            pages = [{'page': 1, 'text': markdown.raw_markdown}]
            title = result.metadata.get('title') or urlsplit(url).hostname
            links = [{'url': public_url(link.href), 'title': link.text or ''}
                     for link in [*result.links.internal, *result.links.external]
                     if link.href.startswith(('http://', 'https://'))][:100]
    else:
        raise ValueError('unsupported_web_content')
    if mime != PDF_MIME and len(pages[0]['text'].strip()) < 40:
        raise ValueError('web_text_unavailable')
    return {'version': 1, 'requestedUrl': requested_url, 'url': url, 'title': title[:200], 'parser': PARSER, 'mediaType': mime,
        'pages': pages, 'links': links, 'redirects': redirects,
        'transport': transport, 'parseError': parse_error,
        'original': {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'base64': base64.b64encode(raw).decode()},
        'egress': 'upstream-v0.9.2-resolve-and-pin-proxy', 'tlsVerification': True}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body):
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path != '/health':
            return self.reply(404, {'error': 'not_found'})
        self.reply(200, {'parser': PARSER, 'pid': os.getpid(), 'sourceHash': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})

    def do_POST(self):
        if (self.path != '/read' or self.headers.get('Host') not in
                (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')
                or self.headers.get('Origin') or self.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
            return self.reply(404, {'error': 'not_found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 6000:
                raise ValueError('invalid_reader_input')
            body = json.loads(self.rfile.read(size))
            if set(body) != {'url', 'remainingMs'} or not isinstance(body['url'], str) or len(body['url']) > 4000:
                raise ValueError('invalid_reader_input')
            result = asyncio.run(asyncio.wait_for(read_public(body['url'], body['remainingMs']), body['remainingMs'] / 1000))
            self.reply(200, result)
        except Exception as error:
            detail = str(error)
            code = detail if re.fullmatch(r'[a-z_]{3,80}', detail) else 'web_read_unavailable'
            if isinstance(error, (TimeoutError, asyncio.TimeoutError)):
                code = 'web_timeout'
            if hasattr(error, 'response'):
                code = 'web_http_' + str(error.response.status_code)
            self.reply(422, {'error': type(error).__name__, 'code': code})


if __name__ == '__main__':
    if sys.argv[1:] == ['--parse-pdf']:
        raw = sys.stdin.buffer.read(PDF_MAX_BYTES + 1)
        # Pipes inherit the Windows legacy console encoding (often GBK).
        # Emit the private JSON protocol as UTF-8 bytes, independently of the
        # host locale; original PDF text must not be dropped or substituted.
        try:
            output = parse_pdf(raw)
        except ValueError as error:
            output = {'error': str(error)}
        except Exception:
            output = {'error': 'pdf_parse_failed'}
        sys.stdout.buffer.write(json.dumps(output, ensure_ascii=False).encode('utf-8'))
    else:
        arguments = argparse.ArgumentParser()
        arguments.add_argument('--port', type=int, default=18095)
        ThreadingHTTPServer(('127.0.0.1', arguments.parse_args().port), Handler).serve_forever()
