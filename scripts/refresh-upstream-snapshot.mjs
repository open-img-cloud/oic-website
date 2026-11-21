#!/usr/bin/env node
// Refreshes src/data/upstream-snapshot.json, the last known upstream lifecycle data:
//   - endoflife.date releases of every product named in images.yaml (eol.product);
//   - OpenStack series status from the release team (openstack/releases).
// The build reads both live; the snapshot is only its fallback when a source cannot be reached,
// so an outage never silently drops the support lines, the EOL badges or the maintained series.
//
//   node scripts/refresh-upstream-snapshot.mjs
//
// Run weekly by .github/workflows/upstream-snapshot.yml, which opens a PR when the data changed.
import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const UA = "openimages.cloud-site";
const EOL_API = "https://endoflife.date/api/v1/products";
const SERIES_URL =
  "https://opendev.org/openstack/releases/raw/branch/master/data/series_status.yaml";
const OUT = "src/data/upstream-snapshot.json";
// Releases that ended more than this long ago are left out (unless images.yaml names them).
const KEEP_EOL_DAYS = 2 * 365;
const isoDate = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

async function get(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res;
}

const catalog = parseYaml(readFileSync("src/data/images.yaml", "utf8"));
const pinned = new Map();
for (const image of catalog.images ?? []) {
  if (!image.eol?.product) continue;
  const set = pinned.get(image.eol.product) ?? new Set();
  if (image.eol.release) set.add(String(image.eol.release));
  pinned.set(image.eol.product, set);
}

const cutoff = Date.now() - KEEP_EOL_DAYS * 86_400_000;
const eol = {};
for (const product of [...pinned.keys()].sort()) {
  const data = await (await get(`${EOL_API}/${encodeURIComponent(product)}`)).json();
  const releases = data?.result?.releases;
  if (!Array.isArray(releases) || releases.length === 0)
    throw new Error(`${product}: no releases in the endoflife.date answer`);
  const kept = {};
  for (const r of releases) {
    const name = String(r.name);
    const eolFrom = isoDate(r.eolFrom);
    if (!pinned.get(product).has(name) && eolFrom && Date.parse(eolFrom) < cutoff) continue;
    kept[name] = {
      eoasFrom: isoDate(r.eoasFrom),
      eolFrom,
      eoesFrom: isoDate(r.eoesFrom),
      isEol: r.isEol === true,
    };
  }
  for (const name of pinned.get(product))
    if (!kept[name]) throw new Error(`${product}: release ${name} (images.yaml) is unknown`);
  eol[product] = kept;
}

// failsafe: every scalar stays a string ("2026.10" must not become 2026.1).
const series = parseYaml(await (await get(SERIES_URL)).text(), { schema: "failsafe" });
if (!Array.isArray(series)) throw new Error(`${SERIES_URL}: not a list`);
const openstackSeries = series
  .filter((s) => s?.status === "maintained" && /^\d{4}\.\d+$/.test(s["release-id"] ?? ""))
  .map((s) => ({
    series: s["release-id"],
    name: String(s.name).replace(/^./, (c) => c.toUpperCase()),
    until: isoDate(s["next-phase"]?.date),
  }))
  .sort((a, b) => b.series.localeCompare(a.series, "en", { numeric: true }));
if (openstackSeries.length === 0) throw new Error(`${SERIES_URL}: no maintained series`);

// fetched_at only moves when the data does, so an unchanged week opens no PR.
const previous = (() => {
  try {
    return JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    return null;
  }
})();
const body = { eol, openstack_series: openstackSeries };
const same =
  previous &&
  JSON.stringify({ eol: previous.eol, openstack_series: previous.openstack_series }) ===
    JSON.stringify(body);
const out = {
  fetched_at: same ? previous.fetched_at : new Date().toISOString().slice(0, 10),
  ...body,
};
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
const count = Object.values(eol).reduce((n, r) => n + Object.keys(r).length, 0);
console.log(
  `${OUT}: ${count} releases of ${Object.keys(eol).length} products, ` +
    `${openstackSeries.length} maintained OpenStack series${same ? " (unchanged)" : ""}`,
);
