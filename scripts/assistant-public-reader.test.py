"""Offline process-framing checks; PDF parsing itself remains pypdf's job."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


class ReaderProcessTests(unittest.TestCase):
    def test_pdf_child_emits_utf8_json_even_with_a_legacy_windows_pipe_encoding(self):
        reader = Path(__file__).with_name('assistant-public-reader.py')
        # Stub only the parser to isolate child stdout framing from file fonts,
        # the network and pypdf. This string is not representable in GBK.
        probe = r'''
import runpy, sys, types
class Reader:
    is_encrypted = False
    pages = [types.SimpleNamespace(extract_text=lambda: '条件 ≥ 25℃；ﬁ；😀')]
    def __init__(self, raw): pass
sys.modules['pypdf'] = types.SimpleNamespace(PdfReader=Reader)
sys.argv = [sys.argv[1], '--parse-pdf']
runpy.run_path(sys.argv[0], run_name='__main__')
'''
        child = subprocess.run([sys.executable, '-c', probe, str(reader)],
            input=b'%PDF-labelled-process-fixture', capture_output=True,
            env={**os.environ, 'PYTHONIOENCODING': 'gbk'}, timeout=10)
        self.assertEqual(child.returncode, 0, child.stderr.decode('ascii', errors='replace'))
        self.assertEqual(json.loads(child.stdout.decode('utf-8')),
            [{'page': 1, 'text': '条件 ≥ 25℃；ﬁ；😀'}])


if __name__ == '__main__':
    unittest.main()
