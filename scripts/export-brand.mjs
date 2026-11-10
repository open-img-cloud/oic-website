// Regenerates the raster brand assets from the SVG sources in brand/.
//   node scripts/export-brand.mjs
// og.svg and github-banner.svg use Inter and JetBrains Mono: install both
// fonts system-wide first, otherwise librsvg falls back to another face.
import sharp from "sharp";

const jobs = [
  { src: "brand/favicon.svg", out: "public/favicon-32.png", size: 32 },
  { src: "brand/logo.svg", out: "public/img/icon-180.png", size: 180 },
  { src: "brand/logo.svg", out: "brand/avatar-512.png", size: 512 },
  { src: "brand/og.svg", out: "public/img/og.png" },
  { src: "brand/github-banner.svg", out: "brand/github-banner.png" },
];

for (const { src, out, size } of jobs) {
  let img = sharp(src, { density: 300 });
  if (size) img = img.resize(size, size);
  await img.png({ compressionLevel: 9 }).toFile(out);
  console.log(`${src} -> ${out}`);
}
