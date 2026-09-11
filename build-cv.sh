#!/bin/bash
# Build the CV PDFs from their HTML sources — English and Norwegian.
# (Norwegian is a working draft, pending native review, like the site copy.)
# Two steps per language:
#   1. Chrome renders cv*.html → PDF (equal @page margins, natural flow).
#   2. PyMuPDF paints the site's broken-white ground (#F8F5EF) behind every
#      page, filling the margins too — full-bleed colour that plain CSS +
#      Chrome print cannot do (the top margin of continuation pages stays
#      white otherwise). Layout is untouched; only the background is added.
#
# The portfolio's résumé link (index.html) follows the language switch:
# EN → Wioleta-Wojcik-CV.pdf, NO → Wioleta-Wojcik-CV-NO.pdf. Keep those
# output names in sync with the `cvfile` values in index.html's T model.
set -e
cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# each pair: "<source html>|<output pdf>"
BUILDS=(
  "cv.html|Wioleta-Wojcik-CV.pdf"
  "cv-no.html|Wioleta-Wojcik-CV-NO.pdf"
)

for pair in "${BUILDS[@]}"; do
  SRC="${pair%%|*}"
  OUT="${pair##*|}"
  RAW="/tmp/${SRC%.html}-raw.pdf"

  "$CHROME" --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=6000 \
    --print-to-pdf="$RAW" "file://$PWD/$SRC"

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
done
