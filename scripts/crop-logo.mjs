import sharp from "sharp";

const src = "src/assets/open-images-banner.png";
const meta = await sharp(src).metadata();
console.log("banner:", meta.width, "x", meta.height);

await sharp(src)
  .extract({ left: 175, top: 110, width: 510, height: 580 })
  .resize(512, 512, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toFile("src/assets/open-images-icon.png");

await sharp("src/assets/open-images-icon.png").resize(128).png().toFile("public/img/icon-128.png");

// Favicon (32x32 PNG — modern browsers accept PNG favicons over ICO).
await sharp("src/assets/open-images-icon.png").resize(32).png().toFile("public/favicon-32.png");

// Open Graph image for social sharing (1200x630, padded with the banner's navy bg).
await sharp(src)
  .resize(1200, 630, {
    fit: "contain",
    background: { r: 13, g: 29, b: 54, alpha: 1 },
  })
  .png()
  .toFile("public/img/og.png");

console.log("icon (512px) + 128px + 32px favicon + 1200x630 OG image ready");
