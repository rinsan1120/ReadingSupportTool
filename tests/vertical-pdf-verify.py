"""Verify PDFs from vertical-pdf-browser.cjs, optionally render with --render."""
from collections import Counter
import json
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
import pdfplumber
from pypdf import PdfReader

root = Path(__file__).resolve().parent.parent / 'tmp' / 'pdfs'
manifest = json.loads((root / 'vertical-manifest.json').read_text(encoding='utf-8'))

def characters(text):
    # Yu Mincho embeds these two equivalent CJK radical glyph aliases.
    return Counter(re.sub(r'\s', '', unicodedata.normalize('NFKC', text.replace('⻩', '黄').replace('⻑', '長'))))

for item in manifest:
    file = root / item['filename']
    assert len(PdfReader(file).pages) == item['pages']
    with pdfplumber.open(file) as pdf:
        for i, page in enumerate(pdf.pages):
            actual = ''.join(char['text'] for char in page.chars)
            expected = item['expectedPages'][i]
            assert characters(actual) == characters(expected), (file.name, i + 1, characters(actual) - characters(expected), characters(expected) - characters(actual))
            assert abs(page.width - 595.28) < 1 and abs(page.height - 841.89) < 1
            for char in page.chars:
                assert char['x0'] >= 40 and char['x1'] <= page.width - 39, (file.name, i + 1, char)
                assert char['top'] >= 40 and char['bottom'] <= page.height - 39, (file.name, i + 1, char)
    print(f'PASS {file.name}: {item["pages"]} A4 pages; every text/ruby/memo character stays within margins')
    if '--render' in sys.argv:
        subprocess.run(['pdftoppm', '-scale-to', '1100', '-png', str(file), str(root / file.stem)], check=True)
