#!/usr/bin/env node
// IndexNow: tell search engines (Bing, Yandex, Seznam, Naver...) which pages changed.
//
//   node scripts/indexnow.mjs changed > changed.txt   # before deploy: built pages that differ from the live site
//   node scripts/indexnow.mjs submit changed.txt      # after deploy: submit them
//
// The key is the 32-hex file in public/ (served at /<key>.txt), as the protocol requires.
import { existsSync, readFileSync, readdirSync } from "node:fs";

const SITE = "https://openimages.cloud";
const UA = "openimages-ci";

function key() {
  const file = readdirSync("public").find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  if (!file) throw new Error("no IndexNow key file in public/");
  return file.slice(0, -4);
}

// The Astro sitemap, plus the documentation sitemap (Zensical, under /docs/)
// when scripts/build-docs.sh has run.
const SITEMAPS = ["dist/sitemap-0.xml", "dist/docs/sitemap.xml"];

function builtUrls() {
  const urls = [];
  for (const file of SITEMAPS) {
    if (file !== SITEMAPS[0] && !existsSync(file)) continue;
    const xml = readFileSync(file, "utf8");
    urls.push(...[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()));
  }
  return urls;
}

function distFile(url) {
  const path = new URL(url).pathname;
  return `dist${path}${path.endsWith("/") ? "index.html" : ""}`;
}

async function changed() {
  for (const url of builtUrls()) {
    const built = readFileSync(distFile(url), "utf8");
    let live = null;
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (res.ok) live = await res.text();
    } catch {
      live = null;
    }
    if (live !== built) console.log(url);
  }
}

async function submit(listFile) {
  const urlList = readFileSync(listFile, "utf8").split("\n").filter(Boolean);
  if (urlList.length === 0) {
    console.log("indexnow: no changed page");
    return;
  }
  const k = key();
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", "user-agent": UA },
    body: JSON.stringify({
      host: new URL(SITE).host,
      key: k,
      keyLocation: `${SITE}/${k}.txt`,
      urlList,
    }),
  });
  // 200 and 202 are both success; anything else is reported but never fails a deploy.
  console.log(`indexnow: ${urlList.length} URL(s) submitted, HTTP ${res.status}`);
  if (![200, 202].includes(res.status)) console.log(await res.text());
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "changed") await changed();
else if (cmd === "submit") await submit(arg);
else {
  console.error("usage: indexnow.mjs changed | submit <file>");
  process.exit(2);
}
