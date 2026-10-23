#!/usr/bin/env bash
# Renders the brand mark into every icon the clients ship. Run after changing
# brand/assets/mark.svg or the brand color, then commit brand/assets/generated.
# Needs rsvg-convert (librsvg) and python3 with Pillow, fontTools, brotli, and
# uharfbuzz (pip install pillow fonttools brotli uharfbuzz); PYTHON picks a
# python3 other than the one on the PATH.
set -euo pipefail
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
OUT=assets/generated
rm -rf "$OUT" && mkdir -p "$OUT/browser" "$OUT/web" "$OUT/agent"

COLOR=$($PY -c "import json; print(json.load(open('brand.json'))['color'])")
PATH_D=$(sed -E 's/.* d="([^"]+)".*/\1/' assets/mark.svg)

# The mark is 26x32. Pad it into a square so icons render centered.
square() { # fill
  printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 0 32 32"><path fill="%s" fill-rule="evenodd" d="%s"/></svg>' "$1" "$PATH_D"
}
render() { # fill size out
  square "$1" | rsvg-convert -w "$2" -h "$2" -o "$3"
}

for s in 16 19 32 38 48 96 128; do
  render "$COLOR" "$s" "$OUT/browser/icon$s.png"
  render "#8A8A8A" "$s" "$OUT/browser/icon${s}_gray.png"
done
for s in 19 38; do
  render "#6F9A8F" "$s" "$OUT/browser/icon${s}_locked.png"
done
# Safari toolbar icons are template images: black on transparent.
render "#000000" 18 "$OUT/browser/icon18_safari.png"
render "#000000" 36 "$OUT/browser/icon18_safari@2x.png"
render "#00000080" 18 "$OUT/browser/icon18_safari_locked.png"
render "#00000080" 36 "$OUT/browser/icon18_safari_locked@2x.png"

# The desktop agent's tray icon (the agent is in passbundle-apps, which copies these). The macOS menu bar wants a template image
# (black on transparent, 18 points); Windows shows the mark in color.
render "#000000" 36 "$OUT/agent/tray-macos.png"
render "$COLOR" 32 "$OUT/agent/tray-windows.png"

render "$COLOR" 180 "$OUT/web/apple-touch-icon.png"
render "$COLOR" 16 "$OUT/web/favicon-16x16.png"
render "$COLOR" 32 "$OUT/web/favicon-32x32.png"
render "$COLOR" 192 "$OUT/web/android-chrome-192x192.png"
render "$COLOR" 512 "$OUT/web/android-chrome-512x512.png"
render "$COLOR" 150 "$OUT/web/mstile-150x150.png"
square "#000000" > "$OUT/web/safari-pinned-tab.svg"

# The logo: the jewel tile and the two-tone wordmark, drawn by wordmark.py
# (outlines, not SVG text, so it looks the same everywhere): for the shared
# logo component, the navigation's corner, the navigation closed to icons,
# and as images. The PNGs are 2x of the 284x52 SVGs, like upstream's.
NAME=$($PY -c "import json; print(json.load(open('brand.json'))['name'])")
$PY wordmark.py "$OUT"
rsvg-convert -w 568 -h 104 "$OUT/web/logo.svg" -o "$OUT/web/logo-primary@2x.png"
rsvg-convert -w 568 -h 104 "$OUT/web/logo.svg" -o "$OUT/web/logo-dark@2x.png"
rsvg-convert -w 568 -h 104 "$OUT/web/logo-white.svg" -o "$OUT/web/logo-white@2x.png"
# Small square icon, used in onboarding and org lists.
printf '<svg width="20" height="20" viewBox="-3 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" data-brand="%s"><path fill="%s" fill-rule="evenodd" d="%s"/></svg>' "$NAME" "$COLOR" "$PATH_D" > "$OUT/icon-square.svg"
$PY - "$OUT/web" <<'PY'
import sys
from PIL import Image
d = sys.argv[1]
Image.open(f"{d}/favicon-32x32.png").save(f"{d}/favicon.ico", sizes=[(16, 16), (32, 32)])
PY

echo "rendered $(find "$OUT" -type f | wc -l | tr -d ' ') files into $OUT"
