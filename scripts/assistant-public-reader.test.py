"""Offline process-framing checks; PDF parsing itself remains pypdf's job."""
import asyncio
from contextlib import asynccontextmanager
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

READER = Path(__file__).with_name('assistant-public-reader.py')
SPEC = importlib.util.spec_from_file_location('public_reader', READER)
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)


class ReaderProcessTests(unittest.TestCase):
    def test_pdf_child_emits_utf8_json_even_with_a_legacy_windows_pipe_encoding(self):
        # Stub only the parser to isolate child stdout framing from file fonts,
        # the network and pypdf. This string is not representable in GBK.
        probe = r'''
import runpy, sys, types
class Reader:
    is_encrypted = False
    pages = [types.SimpleNamespace(extract_text=lambda: '条件 ≥ 25℃；ﬁ；😀', images={})]
    def __init__(self, raw): pass
sys.modules['pypdf'] = types.SimpleNamespace(PdfReader=Reader)
sys.argv = [sys.argv[1], '--parse-pdf']
runpy.run_path(sys.argv[0], run_name='__main__')
'''
        child = subprocess.run([sys.executable, '-c', probe, str(READER)],
            input=b'%PDF-labelled-process-fixture'.ljust(reader.MAX_BYTES + 1), capture_output=True,
            env={**os.environ, 'PYTHONIOENCODING': 'gbk'}, timeout=10)
        self.assertEqual(child.returncode, 0, child.stderr.decode('ascii', errors='replace'))
        self.assertEqual(json.loads(child.stdout.decode('utf-8')),
            [{'page': 1, 'text': '条件 ≥ 25℃；ﬁ；😀', 'status': 'text'}])

    def test_range_contract_rejects_a_changed_version_before_reading_the_body(self):
        class Client:
            requests = []

            @asynccontextmanager
            async def stream(self, method, url, headers):
                self.requests.append(headers)
                yield type('Response', (), {'status_code': 206, 'headers': {'etag': '"changed"'}})()

        client = Client()
        with self.assertRaisesRegex(ValueError, 'pdf_range_unavailable'):
            asyncio.run(reader.read_pdf_ranges(client, 'https://publisher.example/spec.pdf',
                        reader.MAX_BYTES + 1, '"original"'))
        self.assertEqual([request['Range'] for request in client.requests],
                         ['bytes=0-2097151', 'bytes=2097152-4194303', 'bytes=4194304-4194304'])
        self.assertTrue(all(request['If-Match'] == '"original"' for request in client.requests))

    def test_unknown_or_unbounded_range_is_rejected_before_a_request(self):
        for url, size, etag in (
            ('https://publisher.example/spec.pdf', reader.PDF_MAX_BYTES + 1, '"original"'),
            ('https://publisher.example/spec.pdf', reader.MAX_BYTES + 1, 'W/"original"'),
            ('http://publisher.example/spec.pdf', reader.MAX_BYTES + 1, '"original"'),
        ):
            with self.subTest(url=url, size=size, etag=etag), self.assertRaisesRegex(ValueError, 'web_download_limit'):
                asyncio.run(reader.read_pdf_ranges(None, url, size, etag))

    def test_concurrent_ranges_preserve_byte_order_and_reject_missing_bytes(self):
        length = reader.MAX_BYTES + 1
        sizes = [reader.PDF_RANGE_BYTES, reader.PDF_RANGE_BYTES, 1]
        parts = [bytes([index]) * size for index, size in enumerate(sizes, 1)]

        class Client:
            def __init__(self, truncated=False):
                self.truncated = truncated
                self.finished = []

            @asynccontextmanager
            async def stream(self, method, url, headers):
                start, end = map(int, headers['Range'].removeprefix('bytes=').split('-'))
                index = start // reader.PDF_RANGE_BYTES
                client = self

                class Response:
                    status_code = 206
                    headers = {'etag': '"original"', 'content-range': f'bytes {start}-{end}/{length}',
                               'content-type': 'application/pdf'}

                    async def aiter_raw(self):
                        await asyncio.sleep((2 - index) * 0.01)
                        client.finished.append(index)
                        yield b'' if client.truncated and index == 2 else parts[index]

                yield Response()

        url = 'https://publisher.example/spec.pdf'
        client = Client()
        raw = asyncio.run(reader.read_pdf_ranges(client, url, length, '"original"'))
        self.assertEqual(client.finished, [2, 1, 0])
        self.assertEqual(raw, b''.join(parts))
        with self.assertRaisesRegex(ValueError, 'pdf_range_unavailable'):
            asyncio.run(reader.read_pdf_ranges(Client(truncated=True), url, length, '"original"'))


if __name__ == '__main__':
    unittest.main()
