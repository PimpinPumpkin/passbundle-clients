#!/usr/bin/env bash
# Makes the web fonts in brand/assets/fonts from Google Sans Flex, the variable
# font in the google/fonts repository (ofl/googlesansflex/, SIL Open Font
# License 1.1, whose text is brand/assets/fonts/OFL.txt). Version 5.000 came
# from google/fonts commit bd8f81ddb5c74d5c8897b36ad88b440266245103.
#
#   brand/build-fonts.sh "path/to/GoogleSansFlex[ROND,opsz,slnt,wdth,wght].ttf"
#
# Only the weight axis stays variable: the other axes are set to the font's
# defaults (optical size 18, width 100, not rounded, upright), which keeps the
# files small. Two subsets, Latin and Latin Extended, with the unicode ranges
# brand/fonts.css gives them, so a page loads only what it shows.
# Needs python3 with fontTools and brotli (pip install fonttools brotli).
set -euo pipefail
cd "$(dirname "$0")"
src=${1:?"usage: build-fonts.sh <GoogleSansFlex variable TTF>"}
out=assets/fonts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

python3 -m fontTools.varLib.instancer "$src" opsz=18 wdth=100 ROND=0 slnt=0 -o "$tmp/wght.ttf"

latin="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
latin_ext="U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF"
subset() { # unicodes out
  python3 -m fontTools.subset "$tmp/wght.ttf" --unicodes="$1" --layout-features='*' --name-IDs='*' \
    --flavor=woff2 --output-file="$2"
}
subset "$latin" "$out/google-sans-flex-latin.woff2"
subset "$latin_ext" "$out/google-sans-flex-latin-ext.woff2"
ls -l "$out"/google-sans-flex-*.woff2
