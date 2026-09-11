#!/usr/bin/env bash
# Render hospital-wayfinding graphic sheets (HTML) to PNG at 2x.
# Usage:
#   ./build-assets.sh              # render all assets
#   ./build-assets.sh hero-sketch  # render one (name without .html)
# Window size per file is read from the `.sheet{width:..;height:..}` rule.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/hospital-wayfinding/assets"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SCALE=2

render() {
  local name="$1"
  local html="$name.html"
  [ -f "$html" ] || { echo "skip: $html not found"; return; }
  # Pull sheet dimensions (e.g. .sheet{width:1600px;height:900px)
  local dims w h
  dims=$(grep -oiE "\.sheet\{width:[0-9]+px;height:[0-9]+px" "$html" | head -1 | grep -oE "[0-9]+" | tr '\n' ' ')
  w=$(echo "$dims" | awk '{print $1}')
  h=$(echo "$dims" | awk '{print $2}')
  [ -n "$w" ] && [ -n "$h" ] || { echo "skip: no .sheet dims in $html"; return; }
  echo -n "render $name  (${w}x${h} @${SCALE}x -> $((w*SCALE))x$((h*SCALE))) ... "
  local prof; prof=$(mktemp -d)
  local before; before=$(stat -f %m "$name.png" 2>/dev/null || echo 0)
  # new-headless writes the screenshot in a few seconds but does NOT exit on
  # this Chrome build, so launch detached, wait for the PNG to be (re)written,
  # then kill this render's Chrome (isolated by its unique --user-data-dir).
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run \
    --user-data-dir="$prof" \
    --force-device-scale-factor=$SCALE \
    --window-size="${w},${h}" \
    --screenshot="$name.png" \
    "file://$PWD/$html" >/dev/null 2>&1 &
  local i=0 now
  while [ $i -lt 60 ]; do
    sleep 0.5
    now=$(stat -f %m "$name.png" 2>/dev/null || echo 0)
    [ "$now" != "$before" ] && { sleep 0.6; break; }
    i=$((i+1))
  done
  pkill -f "$prof" 2>/dev/null
  wait 2>/dev/null
  rm -rf "$prof"
  if [ "$(stat -f %m "$name.png" 2>/dev/null || echo 0)" != "$before" ]; then echo "ok"; else echo "TIMEOUT"; fi
}

if [ "$#" -ge 1 ]; then
  for n in "$@"; do render "$n"; done
else
  for f in *.html; do render "${f%.html}"; done
fi
echo "rendered."

# Shrink the freshly rendered PNGs (palette quantise, ~60% smaller) if Pillow
# is present, so the delivered files stay web-weight. Keeps the .png references.
if python3 -c "import PIL" 2>/dev/null; then
  echo "optimising..."
  python3 "$ROOT/optimize-assets.py" "$@"
else
  echo "note: Pillow not found — skipping optimise (run: python3 optimize-assets.py)"
fi
echo "done."
