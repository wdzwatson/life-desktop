from io import BytesIO
from pathlib import Path
import textwrap
import zipfile

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "docs" / "archive" / "qa" / "assets" / "reader-at15"
PAGE_WIDTH, PAGE_HEIGHT = A4


def draw_wrapped_text(pdf, text, x, y, width, line_height=14):
    max_chars = max(12, int(width / 6.2))
    for line in textwrap.wrap(text, width=max_chars):
        pdf.drawString(x, y, line)
        y -= line_height
    return y


def create_scanned_image(title, lines):
    image = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(image)
    try:
        title_font = ImageFont.truetype("arial.ttf", 34)
        body_font = ImageFont.truetype("arial.ttf", 25)
    except OSError:
        title_font = ImageFont.load_default()
        body_font = title_font
    draw.rectangle((70, 70, 1170, 1680), outline="#777777", width=3)
    draw.text((110, 120), title, fill="black", font=title_font)
    y = 220
    for line in lines:
        draw.text((110, y), line, fill="#222222", font=body_font)
        y += 58
    stream = BytesIO()
    image.save(stream, format="PNG")
    stream.seek(0)
    return stream


def build_multicolumn_pdf(path):
    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    margin = 48
    gutter = 24
    column_width = (PAGE_WIDTH - margin * 2 - gutter) / 2
    body = (
        "This paragraph verifies that multi-column text remains selectable while outline "
        "analysis runs in a worker. Page turning, scrolling, selection, and window resizing "
        "must stay independent from directory extraction."
    )
    for level in range(8):
        title = f"Level {level + 1} - Acceptance Section"
        key = f"outline-level-{level + 1}"
        pdf.bookmarkPage(key)
        pdf.addOutlineEntry(title, key, level=level, closed=False)
        pdf.setFont("Helvetica-Bold", max(10, 18 - level))
        pdf.drawString(margin, PAGE_HEIGHT - 60, title)
        pdf.setFont("Helvetica", 10)
        pdf.setStrokeColorRGB(0.82, 0.84, 0.87)
        pdf.line(PAGE_WIDTH / 2, 54, PAGE_WIDTH / 2, PAGE_HEIGHT - 92)
        for column in range(2):
            x = margin + column * (column_width + gutter)
            y = PAGE_HEIGHT - 95
            for _ in range(5):
                y = draw_wrapped_text(pdf, body, x, y, column_width)
                y -= 12
        pdf.setFont("Helvetica", 8)
        pdf.drawRightString(PAGE_WIDTH - margin, 28, f"Page {level + 1}")
        pdf.showPage()
    pdf.save()


def build_scanned_pdf(path):
    scanned = create_scanned_image(
        "AT-15 scanned PDF",
        [
            "This page intentionally contains no PDF text objects.",
            "OCR is requested only when the user asks for page recognition.",
            "Saved rectangles must remain normalized after zoom changes.",
        ],
    )
    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    pdf.drawImage(ImageReader(scanned), 0, 0, width=PAGE_WIDTH, height=PAGE_HEIGHT)
    pdf.showPage()
    pdf.save()


def build_mixed_pdf(path):
    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(48, PAGE_HEIGHT - 64, "Mixed PDF - native text page")
    pdf.setFont("Helvetica", 11)
    draw_wrapped_text(
        pdf,
        "Page one has a native text layer. Page two is an embedded scan. The reader must "
        "preserve normal selection on this page and offer OCR only for the scanned page.",
        48,
        PAGE_HEIGHT - 96,
        PAGE_WIDTH - 96,
        16,
    )
    pdf.showPage()
    scanned = create_scanned_image(
        "Mixed PDF - scanned page",
        ["Second page image content.", "Fallback OCR remains page scoped."],
    )
    pdf.drawImage(ImageReader(scanned), 0, 0, width=PAGE_WIDTH, height=PAGE_HEIGHT)
    pdf.showPage()
    pdf.save()


def build_corrupt_pdf(source, path):
    data = source.read_bytes()
    path.write_bytes(data[: max(256, len(data) // 2)])


def build_deep_epub(path):
    chapters = []
    for level in range(1, 9):
        chapters.append(
            f'<?xml version="1.0" encoding="utf-8"?>'
            f'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Level {level}</title></head>'
            f'<body><h1>Level {level}</h1><p>AT-15 EPUB hierarchy content at depth {level}.</p></body></html>'
        )
    nested_nav = ""
    for level in range(8, 0, -1):
        child = f"<ol>{nested_nav}</ol>" if nested_nav else ""
        nested_nav = f'<li><a href="chapter-{level}.xhtml">Level {level}</a>{child}</li>'
    nav = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
        '<head><title>AT-15 Navigation</title></head><body>'
        f'<nav epub:type="toc"><h1>Contents</h1><ol>{nested_nav}</ol></nav>'
        '</body></html>'
    )
    manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>']
    spine = []
    for level in range(1, 9):
        manifest.append(
            f'<item id="chapter-{level}" href="chapter-{level}.xhtml" media-type="application/xhtml+xml"/>'
        )
        spine.append(f'<itemref idref="chapter-{level}"/>')
    package = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        '<dc:identifier id="book-id">lifeos-at15-deep-outline</dc:identifier>'
        '<dc:title>AT-15 Deep Outline EPUB</dc:title><dc:language>en</dc:language></metadata>'
        f'<manifest>{"".join(manifest)}</manifest><spine>{"".join(spine)}</spine></package>'
    )
    container = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
        '</rootfiles></container>'
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OEBPS/content.opf", package)
        archive.writestr("OEBPS/nav.xhtml", nav)
        for level, chapter in enumerate(chapters, start=1):
            archive.writestr(f"OEBPS/chapter-{level}.xhtml", chapter)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    multicolumn = OUTPUT_DIR / "at15-multicolumn-deep-outline.pdf"
    scanned = OUTPUT_DIR / "at15-scanned.pdf"
    mixed = OUTPUT_DIR / "at15-mixed.pdf"
    corrupt = OUTPUT_DIR / "at15-corrupt.pdf"
    epub = OUTPUT_DIR / "at15-deep-outline.epub"
    build_multicolumn_pdf(multicolumn)
    build_scanned_pdf(scanned)
    build_mixed_pdf(mixed)
    build_corrupt_pdf(mixed, corrupt)
    build_deep_epub(epub)
    for path in (multicolumn, scanned, mixed, corrupt, epub):
        print(f"{path.relative_to(ROOT)} {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
