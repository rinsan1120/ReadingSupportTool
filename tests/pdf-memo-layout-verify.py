"""Check and optionally render PDFs from pdf-memo-layout-browser.cjs.

Use bundled Python: python tests/pdf-memo-layout-verify.py OUTPUT_DIR [--render]
"""
from collections import Counter
import json
from pathlib import Path
import re
import subprocess
import sys
import unicodedata

import pdfplumber
from pypdf import PdfReader


def compact(text):
    # Chromium/Windows maps this Yu Mincho glyph to its radical alias.
    return re.sub(r'\s', '', unicodedata.normalize('NFKC', text.replace('⻩', '黄').replace('⻑', '長')))


output = Path(sys.argv[1])
manifest = json.loads((output / 'memo-layout-manifest.json').read_text(encoding='utf-8'))
for item in manifest:
    file = output / item['filename']
    reader = PdfReader(file)
    assert len(reader.pages) == item['prepared']['pages'] == len(item['pages']), file.name
    for page, expected in zip(reader.pages, item['pages']):
        assert abs(float(page.mediabox.width) - 595.28) < 1, file.name
        assert abs(float(page.mediabox.height) - 841.89) < 1, file.name
        # Native ruby may be extracted before its base. Compare character counts
        # while DOM tests separately verify source-line and memo-part ordering.
        assert Counter(compact(page.extract_text())) == Counter(compact(expected)), f'{file.name}: text lost or duplicated'
    with pdfplumber.open(file) as pdf:
        for number, page in enumerate(pdf.pages, 1):
            assert page.chars, f'{file.name}: blank page {number}'
            for char in page.chars:
                assert char['x0'] >= 41 and char['x1'] <= 554, (file.name, number, char)
                assert char['top'] >= 41 and char['bottom'] <= 799, (file.name, number, char)
    print(f'PASS {file.name}: {len(reader.pages)} A4 pages, all text present within margins')
    if '--render' in sys.argv:
        from PIL import Image, ImageDraw, ImageOps
        prefix = output / file.stem
        subprocess.run(['pdftoppm', '-r', '96', '-png', str(file), str(prefix)], check=True, capture_output=True)
        images = sorted((p for p in output.glob(file.stem + '-*.png') if p.stem.split('-')[-1].isdigit()), key=lambda p: int(p.stem.split('-')[-1]))
        contact = Image.new('RGB', (350 * min(4, len(images)), 510 * ((len(images) + 3) // 4)), '#dddddd')
        for index, image_path in enumerate(images):
            with Image.open(image_path) as image:
                thumb = ImageOps.contain(image.convert('RGB'), (330, 475))
                x, y = index % 4 * 350, index // 4 * 510
                contact.paste(thumb, (x + (350 - thumb.width) // 2, y + 25))
                ImageDraw.Draw(contact).text((x + 10, y + 6), str(index + 1), fill='black')
        contact.save(output / (file.stem + '-contact.png'))
