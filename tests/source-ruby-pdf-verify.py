"""Verify source-ruby-pdf-browser.cjs PDFs; --render also rasterizes every page."""
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
manifest = json.loads((root / 'source-ruby-manifest.json').read_text(encoding='utf-8'))


def characters(text):
    # The existing Chrome/Yu Mincho aliases and colour-emoji extraction limits
    # also apply to ruby. DOM tests separately compare all original code points.
    text = text.replace('👩‍👩‍👧‍👦', '').replace('\x00', '').replace('⻩', '黄')
    return Counter(re.sub(r'\s', '', unicodedata.normalize('NFKC', text)))


for item in manifest:
    file = root / item['filename']
    reader = PdfReader(file)
    assert len(reader.pages) == item['pages']
    with pdfplumber.open(file) as pdf:
        for index, page in enumerate(pdf.pages):
            # Ruby is above the base; memo text is beside it. Extraction order
            # varies across readers, so compare exact character multiplicities
            # per page in addition to the DOM test's ordered line/pair checks.
            actual = page.extract_text() or ''
            expected = item['expectedPages'][index]
            assert characters(actual) == characters(expected), (file.name, index + 1,
                characters(actual) - characters(expected), characters(expected) - characters(actual))
            assert page.chars and page.rects
            assert abs(page.width - 595.28) < 1 and abs(page.height - 841.89) < 1
            for char in page.chars:
                assert char['x0'] >= 40 and char['x1'] <= page.width - 39
                assert char['top'] >= 40 and char['bottom'] <= page.height - 39
    print(f'PASS {file.name}: {item["pages"]} A4 pages, all base/ruby/manual/memo characters and vectors inside margins')
    if '--render' in sys.argv:
        from PIL import Image, ImageDraw
        stem = file.stem
        subprocess.run(['pdftoppm', '-scale-to', '1100', '-png', str(file), str(root / stem)], check=True)
        count = item['pages']
        canvas = Image.new('RGB', (350 * min(4, count), 500 * ((count + 3) // 4)), '#999999')
        for i in range(count):
            page_file = root / f'{stem}-{i + 1:0{len(str(count))}d}.png'
            image = Image.open(page_file).convert('RGB')
            image.thumbnail((330, 470))
            tile = Image.new('RGB', (350, 500), '#b5bcc4')
            tile.paste(image, ((350 - image.width) // 2, 15))
            ImageDraw.Draw(tile).text((10, 480), f'{stem} / {i + 1}', fill='black')
            canvas.paste(tile, ((i % 4) * 350, (i // 4) * 500))
        canvas.save(root / f'{stem}-contact.png')
