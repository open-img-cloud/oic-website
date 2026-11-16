#!/usr/bin/env bash
# Build the documentation (open-img-cloud/docs, Zensical) into dist/docs/,
# served at https://openimages.cloud/docs/. Run after `pnpm build`.
#
#   scripts/build-docs.sh [docs checkout, default _docs]
#
# Needs `zensical` on PATH (pinned: pip install zensical==0.1.1), or uv.
set -euo pipefail

src="${1:-_docs}"
zensical_version="0.1.1"
[ -f "$src/zensical.toml" ] || { echo "build-docs: $src/zensical.toml not found" >&2; exit 1; }
[ -d dist ] || { echo "build-docs: run pnpm build first (no dist/)" >&2; exit 1; }

if command -v zensical >/dev/null 2>&1; then
  [ "$(zensical --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)" = "$zensical_version" ] \
    || { echo "build-docs: zensical $zensical_version required" >&2; exit 1; }
else
  zensical() { uvx --from "zensical==$zensical_version" zensical "$@"; }
fi

# Zensical writes site/ next to its config; build from a clean state.
rm -rf "$src/site" dist/docs
(cd "$src" && zensical build --strict --clean)
mv "$src/site" dist/docs

# The Worker sends a strict CSP (self only): refuse pages that would load a
# script, stylesheet, font or frame from another host.
if grep -rnoE '<(script|img|iframe)[^>]+src="(https?:)?//[^"]+"|<link[^>]+rel="(stylesheet|preload|modulepreload)"[^>]+href="(https?:)?//[^"]+"|@import[^;]*(https?:)?//' \
  dist/docs --include='*.html' --include='*.css'; then
  echo "build-docs: external resources found in dist/docs (blocked by the CSP)" >&2
  exit 1
fi
for f in index.html 404.html sitemap.xml search.json; do
  [ -f "dist/docs/$f" ] || { echo "build-docs: dist/docs/$f missing" >&2; exit 1; }
done
echo "build-docs: $(find dist/docs -name index.html | wc -l) pages in dist/docs"
