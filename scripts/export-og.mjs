// Generates one share image (Open Graph, 1200x630) per catalog image:
//   public/img/og/<os_name>.png
//   node scripts/export-og.mjs
// Run it after adding an image to src/data/images.yaml. Like export-brand.mjs it needs
// Inter and JetBrains Mono installed (or FONTCONFIG_FILE pointing at them), otherwise
// librsvg falls back to another face. The images carry no version number, so they only
// change when the catalog entry does.
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import sharp from "sharp";
import { parse } from "yaml";

const SERVICE = {
  "octavia-amphora": "Image for OpenStack Octavia load balancers",
  "manila-service-image": "Image for the OpenStack Manila generic driver",
  "trove-guest-image": "Guest image for OpenStack Trove databases",
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Background of the site-wide og.svg: navy, faded grid, glow behind the left tile.
const brand = readFileSync("brand/og.svg", "utf8");
const defs = brand.match(/<defs>[\s\S]*?<\/defs>/)[0];
const background = [
  '<rect width="1200" height="630" fill="#0b1424"/>',
  brand.match(/<g stroke="#22324f"[\s\S]*?<\/g>/)[0],
  '<circle cx="230" cy="315" r="268.8" fill="url(#glow)"/>',
].join("\n");

// The Open Image Cloud mark, small, bottom right.
const mark = `<g transform="translate(1062 506) scale(1.25)">
  <path d="M32 3.5 57 18v28L32 60.5 7 46V18Z" fill="url(#g)" stroke="url(#g)" stroke-width="5" stroke-linejoin="round"/>
  <g transform="translate(0 2.3)" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.5 36.5 32 44.8l14.5-8.3" stroke="#fff" stroke-opacity=".55" stroke-width="3.6"/>
    <path d="M17.5 29.8 32 38.1l14.5-8.3" stroke="#fff" stroke-opacity=".8" stroke-width="3.6"/>
    <path d="M32 14.5 46.5 22.8 32 31.1 17.5 22.8Z" fill="#fff" stroke="#fff" stroke-width="3.6"/>
    <path d="m27.2 22.9 3.4 2.9 6.1-5.6" stroke="#2459c4" stroke-width="2.6"/>
  </g>
</g>`;

function svgFor(image) {
  const logoPath = image.logo ? `public/img/logos/${image.logo}` : null;
  const logo =
    logoPath && existsSync(logoPath)
      ? `<image x="140" y="235" width="160" height="160" href="data:image/svg+xml;base64,${readFileSync(logoPath).toString("base64")}"/>`
      : "";
  const subtitle = SERVICE[image.os_name] ?? "Cloud image for OpenStack & Proxmox";
  const titleSize = image.title.length > 18 ? 64 : 76;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
${defs}
${background}
<rect x="110" y="205" width="220" height="220" rx="36" fill="#ffffff"/>
${logo}
<text x="390" y="262" font-family="JetBrains Mono" font-weight="500" font-size="20" letter-spacing="2.6" fill="#7f93b5">OPEN IMAGE CLOUD</text>
<text x="388" y="${262 + 22 + titleSize}" font-family="Inter" font-weight="600" font-size="${titleSize}" letter-spacing="-1.6" fill="#f2f5fb">${esc(image.title)}</text>
<text x="390" y="${262 + 22 + titleSize + 56}" font-family="Inter" font-weight="400" font-size="32" fill="#aab8d0">${esc(subtitle)}</text>
<text x="390" y="${262 + 22 + titleSize + 106}" font-family="JetBrains Mono" font-weight="500" font-size="20" fill="#7f93b5">${SERVICE[image.os_name] ? "qcow2 · signed with Sigstore cosign · per OpenStack series" : "qcow2 · signed with Sigstore cosign · boot-tested"}</text>
${mark}
</svg>`;
}

const { images } = parse(readFileSync("src/data/images.yaml", "utf8"));
mkdirSync("public/img/og", { recursive: true });
for (const image of images) {
  const out = `public/img/og/${image.os_name}.png`;
  await sharp(Buffer.from(svgFor(image)), { density: 72 })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(out);
}
