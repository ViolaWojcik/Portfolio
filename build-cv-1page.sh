#!/bin/bash
# Build the one-page leave-behind CV PDF from cv-1page.html.
# Same two-step pipeline as build-cv.sh:
#   1. Chrome renders cv-1page.html → PDF (equal @page margins).
#   2. PyMuPDF paints the site's broken-white ground (#F8F5EF) behind the
#      page, filling the margins too — full-bleed colour Chrome print can't do.
# Standalone file — NOT linked anywhere on the site.
set -e
cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
RAW="/tmp/cv-1page-raw.pdf"
OUT="Wioleta-Wojcik-1page.pdf"

"$CHROME" --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=6000 \
  --print-to-pdf="$RAW" "file://$PWD/cv-1page.html"

python3 - "$RAW" "$OUT" <<'PY'
import sys, fitz
raw, out = sys.argv[1], sys.argv[2]
doc = fitz.open(raw)
ivory = (248/255, 245/255, 239/255)   # #F8F5EF
for page in doc:
    page.draw_rect(page.rect, color=ivory, fill=ivory, overlay=False)  # behind all content
doc.save(out)
print(f"{out}: {doc.page_count} pages, full-bleed ground added")
PY
