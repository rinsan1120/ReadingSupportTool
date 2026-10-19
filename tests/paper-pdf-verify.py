"""Compare every page from paper-mode-browser.cjs; --render compares pixels too."""
from pathlib import Path
import subprocess
import sys

import pdfplumber
from pypdf import PdfReader

root = Path(__file__).resolve().parent.parent / 'tmp' / 'pdfs'
for width in (1200, 390, 320):
    files = [root / f'paper-{width}-{state}.pdf' for state in ('on', 'off')]
    count = len(PdfReader(files[0]).pages)
    assert count > 1 and len(PdfReader(files[1]).pages) == count
    with pdfplumber.open(files[0]) as on, pdfplumber.open(files[1]) as off:
        for first, second in zip(on.pages, off.pages):
            assert abs(first.width - 595.28) < 1 and abs(first.height - 841.89) < 1
            assert first.chars and first.extract_text() == second.extract_text()
            # Text, ruby, memo, marker and pen geometry/colours must all match.
            for kind in ('chars', 'rects', 'curves', 'lines'):
                assert getattr(first, kind) == getattr(second, kind), (width, first.page_number, kind)
    if '--render' in sys.argv:
        from PIL import Image, ImageChops, ImageDraw
        for file in files:
            subprocess.run(['pdftoppm', '-scale-to', '1100', '-png', str(file), str(file.with_suffix(''))], check=True)
        contact = Image.new('RGB', (350 * min(4, count), 500 * ((count + 3) // 4)), '#b5bcc4')
        for index in range(1, count + 1):
            images = [Image.open(root / f'{file.stem}-{index:0{len(str(count))}d}.png').convert('RGB') for file in files]
            assert ImageChops.difference(*images).getbbox() is None, (width, index, 'pixels')
            images[0].thumbnail((330, 470))
            x, y = ((index - 1) % 4) * 350, ((index - 1) // 4) * 500
            contact.paste(images[0], (x + 10, y + 10))
            ImageDraw.Draw(contact).text((x + 10, y + 480), f'{width}px / page {index}', fill='black')
        contact.save(root / f'paper-{width}-contact.png')
    print(f'PASS {width}px: {count} A4 pages, identical text/vectors/colours' + (' and every rendered pixel' if '--render' in sys.argv else ''))
