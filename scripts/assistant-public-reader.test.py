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
            @asynccontextmanager
            async def stream(self, method, url, headers):
                self.request = headers
                yield type('Response', (), {'status_code': 206, 'headers': {'etag': '"changed"'}})()

        client = Client()
        with self.assertRaisesRegex(ValueError, 'pdf_range_unavailable'):
            asyncio.run(reader.read_pdf_ranges(client, 'https://publisher.example/spec.pdf',
                        reader.MAX_BYTES + 1, '"original"'))
        self.assertEqual(client.request['Range'], 'bytes=0-2097151')
        self.assertEqual(client.request['If-Match'], '"original"')

    def test_unknown_or_unbounded_range_is_rejected_before_a_request(self):
        for url, size, etag in (
            ('https://publisher.example/spec.pdf', reader.PDF_MAX_BYTES + 1, '"original"'),
            ('https://publisher.example/spec.pdf', reader.MAX_BYTES + 1, 'W/"original"'),
            ('http://publisher.example/spec.pdf', reader.MAX_BYTES + 1, '"original"'),
        ):
            with self.subTest(url=url, size=size, etag=etag), self.assertRaisesRegex(ValueError, 'web_download_limit'):
                asyncio.run(reader.read_pdf_ranges(None, url, size, etag))


if __name__ == '__main__':
    unittest.main()
