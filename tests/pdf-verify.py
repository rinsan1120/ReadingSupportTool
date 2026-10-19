"""Verify PDF fixtures from pdf-browser.cjs with pypdf and pdfplumber.

Run with the bundled Python. Add --render to rasterize every page with Poppler
and make contact sheets for visual QA (requires Pillow and pdftoppm on PATH).
"""
import json
from pathlib import Path
import re
import subprocess
import sys
import unicodedata

import pdfplumber
from pypdf import PdfReader

root = Path(__file__).resolve().parent.parent / 'tmp' / 'pdfs'
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))


def compact(text):
    # Windows/Chromium's font reverse cmap uses radical aliases for some Yu
    # Mincho glyphs. Colour-family emoji extract as NULs in this environment.
    # Account ONLY for these observed, documented search limitations; the DOM
    # test independently verifies every source code point before PDF generation.
    text = text.replace('👩‍👩‍👧‍👦', '').replace('\x00', '').replace('⻩', '黄')
    return re.sub(r'\s', '', unicodedata.normalize('NFKC', text))


for item in manifest:
    file = root / item['filename']
    reader = PdfReader(file)
    assert len(reader.pages) == len(item['pages']), f'{file.name}: extra/missing pages'
    for index, (page, expected) in enumerate(zip(reader.pages, item['pages'])):
        actual = page.extract_text()
        assert compact(actual) == compact(expected), f'{file.name} page {index + 1}: text differs\n{actual[:200]!r}\n{expected[:200]!r}'
        assert actual.strip(), f'{file.name}: blank page'
        assert abs(float(page.mediabox.width) - 595.28) < 1
        assert abs(float(page.mediabox.height) - 841.89) < 1
    with pdfplumber.open(file) as pdf:
        for index, page in enumerate(pdf.pages):
            for char in page.chars:
                assert char['top'] >= 40 and char['bottom'] <= 802, f'{file.name} page {index + 1}: text outside printable margins'
    print(f'PASS {file.name}: {len(reader.pages)} A4 pages; text ordered and within margins (known font aliases/colour emoji excluded from exact Unicode comparison)')
    if '--render' in sys.argv:
        from PIL import Image, ImageOps, ImageDraw
        prefix = root / file.stem
        subprocess.run(['pdftoppm', '-r', '96', '-png', str(file), str(prefix)], check=True, capture_output=True)
        thumbs = []
        images = [p for p in root.glob(file.stem + '-*.png') if p.stem.split('-')[-1].isdigit()]
        for image_path in sorted(images, key=lambda p: int(p.stem.split('-')[-1])):
            with Image.open(image_path) as image:
                thumb = ImageOps.contain(image.convert('RGB'), (300, 425))
                canvas = Image.new('RGB', (320, 455), '#dddddd')
                canvas.paste(thumb, ((320 - thumb.width) // 2, 22))
                ImageDraw.Draw(canvas).text((10, 5), image_path.name, fill='black')
                thumbs.append(canvas)
        sheet = Image.new('RGB', (320 * min(4, len(thumbs)), 455 * ((len(thumbs) + 3) // 4)), '#cccccc')
        for i, thumb in enumerate(thumbs):
            sheet.paste(thumb, ((i % 4) * 320, (i // 4) * 455))
        sheet.save(root / (file.stem + '-contact.png'))
