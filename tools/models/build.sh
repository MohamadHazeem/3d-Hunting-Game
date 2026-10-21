#!/bin/sh
# Rebuild public/models from the CC0 sources (Poly Haven, no account needed).
#
#   tools/models/build.sh [download dir]
#
# The download dir (default: a temp folder) holds the big source files; only
# the processed results land in public/models. Needs node and python3 with
# Pillow and numpy.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
dl="${1:-${TMPDIR:-/tmp}/lebanon-hunt-assets}"
out="$repo/public/models"

(cd "$here" && npm install --no-audit --no-fund)
node "$here/fetch.mjs" "$dl"
python3 -I "$here/bake_foliage.py" "$dl" "$out"
node "$here/build_models.mjs" "$dl" "$out"
node "$here/credits.mjs" "$dl" "$out"
du -sh "$out"
