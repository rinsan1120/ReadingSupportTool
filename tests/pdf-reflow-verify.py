"""Check actual exported PDFs, including the binding strip and native type size."""
from collections import Counter
import json
import logging
from pathlib import Path
import re
import sys
import unicodedata

import pdfplumber
from pypdf import PdfReader

def compact(text):
    # Chromium's color-emoji font has no ToUnicode entry for this fixture's ZWJ
    # family (four NUL glyphs in PDF extraction). DOM order and rendered PNGs
    # verify the emoji; compare all other PDF text exactly.
    text = re.sub('[👩👧👦\u200d\x00]', '', text)
    return re.sub(r'\s', '', unicodedata.normalize('NFKC', text.replace('⻩', '黄').replace('⻑', '長')))

folder = Path(sys.argv[1])
logging.getLogger('pdfminer.pdffont').setLevel(logging.ERROR)
for item in json.loads((folder / 'manifest.json').read_text(encoding='utf-8')):
    file = folder / item['filename']
    reader = PdfReader(file)
    assert len(reader.pages) == item['sheets'], (file.name, len(reader.pages), item['sheets'])
    spread = item['layout'] == 'spread'
    size = (841.89, 595.28) if spread else (595.28, 841.89)
    for page, expected in zip(reader.pages, item['expectedPages']):
        assert abs(float(page.mediabox.width) - size[0]) < 1
        assert abs(float(page.mediabox.height) - size[1]) < 1
        assert Counter(compact(page.extract_text())) == Counter(compact(expected)), f'{file.name}: text lost or duplicated'
    with pdfplumber.open(file) as pdf:
        for page, expected in zip(pdf.pages, item['expectedPages']):
            assert page.chars, f'{file.name}: blank page'
            # This fixture's note-only sheets start with their reference header;
            # their own memo/title fonts intentionally differ from the body.
            if not expected.startswith('本文'):
                assert any(abs(c['size'] - item['fontSize'] * .75) < .1 for c in page.chars), f'{file.name}: body type size changed'
            for ink in [*page.chars, *page.rects, *page.curves]:
                assert ink['x0'] >= 41 and ink['x1'] <= size[0] - 41, (file.name, ink)
                assert ink['top'] >= 41 and ink['bottom'] <= size[1] - 41, (file.name, ink)
                if spread:
                    if ink.get('fill') and not ink.get('stroke') and ink.get('non_stroking_color') in [(1, 1, 1), [1, 1, 1]]:
                        continue  # Paper/background is white, not printed content.
                    left, right = size[0] / 2 - 10 * 72 / 25.4, size[0] / 2 + 10 * 72 / 25.4
                    assert ink['x1'] <= left + 1 or ink['x0'] >= right - 1, f'{file.name}: ink in central binding strip'
    print(f'PASS {file.name}: {len(reader.pages)} pages; full text, type size, margins and binding strip')
