#!/usr/bin/env bash
# Renders the brand mark into every icon the clients ship. Run after changing
# brand/assets/mark.svg or the brand color, then commit brand/assets/generated.
# Needs rsvg-convert (librsvg) and python3 with Pillow.
set -euo pipefail
cd "$(dirname "$0")"
OUT=assets/generated
rm -rf "$OUT" && mkdir -p "$OUT/browser" "$OUT/web" "$OUT/agent"

COLOR=$(python3 -c "import json; print(json.load(open('brand.json'))['color'])")
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

# Wordmark: the mark plus the product name, 284x43 (568x86 at 2x, like upstream).
NAME=$(python3 -c "import json; print(json.load(open('brand.json'))['name'])")
wordmark() { # fill [class]
  local cls=""; [ -n "${2:-}" ] && cls=" class=\"$2\""
  printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 284 43" data-brand="%s"><title>%s</title><path%s fill="%s" fill-rule="evenodd" transform="translate(2 3.5) scale(1.125)" d="%s"/><text%s fill="%s" x="42" y="32" font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="30" font-weight="700">%s</text></svg>' \
    "$NAME" "$NAME" "$cls" "$1" "$PATH_D" "$cls" "$1" "$NAME"
}
wordmark "$COLOR" > "$OUT/web/logo.svg"
wordmark "#FFFFFF" > "$OUT/web/logo-white.svg"
wordmark "$COLOR" | rsvg-convert -w 568 -h 86 -o "$OUT/web/logo-primary@2x.png"
wordmark "#1B1B1B" | rsvg-convert -w 568 -h 86 -o "$OUT/web/logo-dark@2x.png"
wordmark "#FFFFFF" | rsvg-convert -w 568 -h 86 -o "$OUT/web/logo-white@2x.png"
# For the shared logo component, colored by the app theme through CSS classes.
wordmark "currentColor" "tw-fill-marketing-logo" > "$OUT/wordmark-themed.svg"
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 32" fill="none" data-brand="%s"><path class="tw-fill-fg-nav" fill-rule="evenodd" d="%s"/></svg>' "$NAME" "$PATH_D" > "$OUT/mark-themed.svg"

# Product logos in the navigation: mark, name, and a product line underneath.
# Colored by the nav theme through CSS classes, like upstream's.
product_logo() { # subtitle out
  printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 49" fill="none" data-brand="%s"><title>%s %s</title><path class="tw-fill-fg-nav" fill-rule="evenodd" transform="translate(0 6.5) scale(1.125)" d="%s"/><text class="tw-fill-fg-nav" x="38" y="25" font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="24" font-weight="700">%s</text><text class="tw-fill-fg-nav" x="38" y="44" font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="13" font-weight="500">%s</text></svg>' \
    "$NAME" "$NAME" "$1" "$PATH_D" "$NAME" "$1" > "$2"
}
product_logo "Password Manager" "$OUT/logo-password-manager.svg"
product_logo "Admin Console" "$OUT/logo-admin-console.svg"
product_logo "Provider Portal" "$OUT/logo-provider-portal.svg"
product_logo "Secrets Manager" "$OUT/logo-secrets-manager.svg"
# Small square icon, used in onboarding and org lists.
printf '<svg width="20" height="20" viewBox="-3 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" data-brand="%s"><path fill="%s" fill-rule="evenodd" d="%s"/></svg>' "$NAME" "$COLOR" "$PATH_D" > "$OUT/icon-square.svg"
python3 - "$OUT/web" <<'PY'
import sys
from PIL import Image
d = sys.argv[1]
Image.open(f"{d}/favicon-32x32.png").save(f"{d}/favicon.ico", sizes=[(16, 16), (32, 32)])
PY

echo "rendered $(find "$OUT" -type f | wc -l | tr -d ' ') files into $OUT"
