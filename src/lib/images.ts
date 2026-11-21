import { parse as parseYaml } from "yaml";
import imagesYamlRaw from "~/data/images.yaml?raw";

/** Lifecycle of a catalog entry (IMAGE_STANDARDS.md, section I). */
export type ImageStatus = "stable" | "archive" | "preview";

export interface Variant {
  id: string;
  label: string;
  /** Short explanation shown next to the variant (e.g. "legacy BIOS boot"). */
  hint?: string;
  filename_template?: string;
}

export interface ImageEntry {
  os_name: string;
  title: string;
  tagline: string;
  description: string;
  repo: string;
  upstream_homepage?: string;
  latest_version: string;
  previous_versions?: string[];
  format: string;
  arch: string;
  tags: string[];
  variants?: Variant[];
  logo?: string;
  status?: ImageStatus;
  /** One-line note shown as a banner on the image page (EOL, known issue…). */
  status_note?: string;
  /** Default cloud-init login user, shown in the quick start. */
  login_user?: string;
  /** Featured on the home page. */
  /** Home page position (1 first); absent: listed in the catalog only. */
  featured?: number;
  /** OpenStack `os_distro` (libosinfo short distro name), e.g. "debian", "rocky", "ol". */
  os_distro?: string;
  /**
   * OpenStack `os_version`. Derived from latest_version when absent ("9.8-20260525.0" gives
   * "9.8"); set to null to leave it out (version is not an OS release, e.g. a build date).
   */
  os_version?: string | null;
  /** Extra Glance properties for this image, merged over DEFAULT_GLANCE_PROPERTIES. */
  glance_properties?: Record<string, string>;
  /**
   * Upstream test image republished unchanged (CirrOS): no cloud-init, well-known password.
   * No Proxmox template commands, left out of the osism export.
   */
  test_image?: boolean;
  /**
   * endoflife.date product and release giving the support dates. Without `release`, the
   * image follows upstream releases: major.minor of the latest version, then major.
   */
  eol?: { product: string; release?: string };
  /** Built per OpenStack series: the quick panel offers every maintained series published. */
  openstack_series?: boolean;
  /** Search title and description, for images the generic wording does not fit (rescue). */
  seo_title?: string;
  seo_description?: string;
}

export type Firmware = "uefi" | "bios";

/** MANIFEST.json as written by the reusable build workflows in open-img-cloud/.github. */
export interface Manifest {
  name: string;
  version: string;
  variant: string | null;
  format: string;
  filename: string;
  sha256: string;
  upstream_url?: string;
  built_at?: string;
  commit?: string;
  build_url?: string;
  builder_tool?: string;
  builder?: { image?: string; digest?: string };
  signed: boolean;
  bundle?: string;
  /** Added by publish-image in Nov 2026: absent from manifests published before. */
  sha512?: string | null;
  size?: number | null;
  virtual_size?: number | null;
  firmware?: Firmware | null;
  arch?: string | null;
}

export interface Artifact {
  /** Variant id (MANIFEST-<id>.json), or null for single-artifact images. */
  variantId: string | null;
  /** Variant label, or null for single-artifact images. */
  label: string | null;
  hint: string | null;
  filename: string | null;
  fileUrl: string | null;
  bundleUrl: string | null;
  manifestUrl: string;
  manifest: Manifest | null;
  sizeBytes: number | null;
  /** Disk size seen by the guest, from the manifest; null on older manifests. */
  virtualSize: number | null;
  /** From the manifest, else guessed from the file name (older manifests). */
  firmware: Firmware;
  arch: string;
  /** Downloads of this file (latest/ and versioned paths), null if stats are unavailable. */
  downloads: number | null;
}

export interface Release {
  version: string;
  artifacts: Artifact[];
}

/** An OpenStack series still maintained upstream (openstack_maintained_series in images.yaml). */
export interface MaintainedSeries {
  series: string;
  name: string;
}

/** Support dates of the image's release, from endoflife.date (API v1) at build time. */
export interface Support {
  product: string;
  release: string;
  /** End of active support (bug fixes); null when the product makes no such distinction. */
  activeUntil: string | null;
  /** End of security support: the end of life. */
  securityUntil: string | null;
  /** End of extended support, usually paid (Ubuntu Pro, Debian ELTS, Oracle Extended). */
  extendedUntil: string | null;
  isEol: boolean;
  /** End of life within EOL_SOON_DAYS of the build. */
  eolSoon: boolean;
  /** The image moves to each new upstream release, so this release ending is not the image ending. */
  followsReleases: boolean;
  sourceUrl: string;
}

export const EOL_SOON_DAYS = 183;

export interface EnrichedImage extends ImageEntry {
  status: ImageStatus;
  latest: Release;
  previous: Release[];
  /**
   * Releases offered in the catalog quick panel, newest first: latest only, or for images built
   * per OpenStack series every published series still maintained upstream.
   */
  quick: (Release & { seriesName: string | null })[];
  /** Most recent build time among the latest artifacts, if known. */
  builtAt: string | null;
  /** Manifest used for the provenance panel (first available latest artifact). */
  provenance: Manifest | null;
  signed: boolean;
  /** Downloads of every version of the image, null if stats are unavailable. */
  downloads: number | null;
  /** <os>/versions.json (oic-versions/v1), null when the bucket does not have one yet. */
  versionsUrl: string | null;
  os_version: string | null;
  /** null when the image has no eol mapping or endoflife.date could not be reached. */
  support: Support | null;
}

/** https://images.openimages.cloud/_stats.json, served by the images-router Worker. */
export interface DownloadStats {
  generated_at: string;
  since: string;
  /** "all-time", or "rolling-90d" when the router keeps no long-term totals. */
  window: string;
  total: number;
  images: Record<
    string,
    { total: number; versions: Record<string, number>; files: Record<string, number> }
  >;
}

export const IMAGES_BASE_URL = (
  process.env.IMAGES_BASE_URL ?? "https://images.openimages.cloud"
).replace(/\/$/, "");

/**
 * Certificate identity of every catalog signature: the reusable build workflow
 * in open-img-cloud/.github, not the image repository (keyless signing records
 * the job_workflow_ref). Keep in sync with IMAGE_STANDARDS.md, section A.
 */
export const CERT_IDENTITY_REGEXP =
  "^https://github.com/open-img-cloud/\\.github/\\.github/workflows/build-(libguestfs|dib|nix-flake|freebsd)-image\\.yml@";
export const CERT_OIDC_ISSUER = "https://token.actions.githubusercontent.com";

const FETCH_TIMEOUT_MS = 8000;

type CatalogDoc = { images: ImageEntry[]; openstack_maintained_series?: MaintainedSeries[] };

export function loadImages(): ImageEntry[] {
  const doc = parseYaml(imagesYamlRaw) as CatalogDoc;
  const images = doc.images ?? [];
  return [...images].sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
}

export function loadMaintainedSeries(): MaintainedSeries[] {
  return (parseYaml(imagesYamlRaw) as CatalogDoc).openstack_maintained_series ?? [];
}

function url(osName: string, version: string, file: string): string {
  return `${IMAGES_BASE_URL}/${osName}/${version}/${file}`;
}

async function timedFetch(target: string, init?: RequestInit): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(target, { ...init, signal: ctrl.signal });
  } catch (err) {
    console.warn(`[images] ${init?.method ?? "GET"} ${target} failed:`, (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchManifest(target: string): Promise<Manifest | null> {
  const res = await timedFetch(target);
  if (!res) return null;
  if (!res.ok) {
    console.warn(`[images] manifest ${target} → HTTP ${res.status}`);
    return null;
  }
  try {
    return (await res.json()) as Manifest;
  } catch {
    console.warn(`[images] manifest ${target} is not valid JSON`);
    return null;
  }
}

async function fetchSize(target: string): Promise<number | null> {
  const res = await timedFetch(target, { method: "HEAD" });
  const len = res?.ok ? Number(res.headers.get("content-length")) : NaN;
  return Number.isFinite(len) && len > 0 ? len : null;
}

async function exists(target: string): Promise<boolean> {
  return !!(await timedFetch(target, { method: "HEAD" }))?.ok;
}

/** "9.8-20260525.0" → "9.8", "13-20261103-2651" → "13", "24.04-20261017" → "24.04". */
export function deriveOsVersion(image: ImageEntry): string | null {
  if (image.os_version !== undefined) return image.os_version;
  const head = image.latest_version.split("-")[0];
  return /^\d+(\.\d+)*$/.test(head) ? head : null;
}

async function artifact(
  image: ImageEntry,
  version: string,
  variant: Variant | null,
): Promise<Artifact> {
  const manifestUrl = url(
    image.os_name,
    version,
    variant ? `MANIFEST-${variant.id}.json` : "MANIFEST.json",
  );
  const manifest = await fetchManifest(manifestUrl);
  const filename =
    manifest?.filename ?? variant?.filename_template?.replaceAll("{version}", version) ?? null;
  const fileUrl = manifest && filename ? url(image.os_name, version, filename) : null;
  return {
    variantId: variant?.id ?? null,
    label: variant?.label ?? null,
    hint: variant?.hint ?? null,
    filename,
    fileUrl,
    bundleUrl: fileUrl ? `${fileUrl}.bundle` : null,
    manifestUrl,
    manifest,
    sizeBytes: manifest?.size ?? (fileUrl ? await fetchSize(fileUrl) : null),
    virtualSize: manifest?.virtual_size ?? null,
    firmware: manifest?.firmware ?? (filename?.includes("uefi") ? "uefi" : "bios"),
    arch: manifest?.arch ?? image.arch ?? "x86_64",
    downloads: null,
  };
}

async function release(image: ImageEntry, version: string): Promise<Release> {
  const variants = image.variants?.length ? image.variants : [null];
  return {
    version,
    artifacts: await Promise.all(variants.map((v) => artifact(image, version, v))),
  };
}

async function fetchDownloadStats(): Promise<DownloadStats | null> {
  const target = `${IMAGES_BASE_URL}/_stats.json`;
  const res = await timedFetch(target);
  if (!res?.ok) {
    if (res) console.warn(`[images] ${target} → HTTP ${res.status}, download counts hidden`);
    return null;
  }
  try {
    const stats = (await res.json()) as DownloadStats;
    return stats && typeof stats.images === "object" && stats.images ? stats : null;
  } catch {
    console.warn(`[images] ${target} is not valid JSON, download counts hidden`);
    return null;
  }
}

let statsCache: Promise<DownloadStats | null> | null = null;

/** Download statistics, fetched once per build; null hides every count. */
export function loadDownloadStats(): Promise<DownloadStats | null> {
  statsCache ??= fetchDownloadStats();
  return statsCache;
}

/** Fills the download counts of an artifact list in place. */
function attachDownloads(artifacts: Artifact[], files: Record<string, number> | undefined) {
  for (const a of artifacts) {
    a.downloads = files ? (a.filename ? (files[a.filename] ?? 0) : null) : null;
  }
}

/**
 * The published latest/ alias is the source of truth for the current version: a release
 * moves it, while images.yaml is only updated by hand. images.yaml stays the fallback when
 * the manifest cannot be read (for example before the first release).
 */
async function resolveLatestVersion(image: ImageEntry): Promise<string> {
  const first = image.variants?.[0] ?? null;
  const manifest = await fetchManifest(
    url(image.os_name, "latest", first ? `MANIFEST-${first.id}.json` : "MANIFEST.json"),
  );
  const published = manifest?.version?.trim();
  if (published && published !== image.latest_version) {
    console.warn(
      `[images] ${image.os_name}: images.yaml says ${image.latest_version}, latest/ is ${published}; using ${published}`,
    );
  }
  return published || image.latest_version;
}

export async function enrichImage(
  entry: ImageEntry,
  stats: DownloadStats | null = null,
): Promise<EnrichedImage> {
  const image: ImageEntry = { ...entry, latest_version: await resolveLatestVersion(entry) };
  const versionsUrl = `${IMAGES_BASE_URL}/${image.os_name}/versions.json`;
  const [latest, previous, hasVersions, support] = await Promise.all([
    release(image, image.latest_version),
    // Previous releases are single-artifact (no variant matrix) in the catalog today.
    Promise.all((image.previous_versions ?? []).map((v) => release({ ...image, variants: [] }, v))),
    exists(versionsUrl),
    loadSupport(image),
  ]);
  const imageStats = stats ? (stats.images[image.os_name] ?? { total: 0, files: {} }) : null;
  for (const rel of [latest, ...previous]) attachDownloads(rel.artifacts, imageStats?.files);
  const manifests = latest.artifacts.map((a) => a.manifest).filter((m): m is Manifest => !!m);
  const builtAt =
    manifests
      .map((m) => m.built_at)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1) ?? null;
  const maintained = loadMaintainedSeries();
  const seriesName = (v: string) => maintained.find((m) => m.series === v)?.name ?? null;
  // Maintained series published but not (yet) listed in previous_versions: probe the bucket,
  // a series that was never built has no manifest and is dropped below.
  const listed = new Set([image.latest_version, ...(image.previous_versions ?? [])]);
  const unlisted = image.openstack_series
    ? await Promise.all(
        maintained
          .filter((m) => !listed.has(m.series))
          .map((m) => release({ ...image, variants: [] }, m.series)),
      )
    : [];
  const quick = image.openstack_series
    ? [latest, ...previous.filter((r) => seriesName(r.version)), ...unlisted]
        .filter((r, i) => i === 0 || r.artifacts.some((a) => a.fileUrl))
        .sort((a, b) => b.version.localeCompare(a.version, "en", { numeric: true }))
        .map((r) => ({ ...r, seriesName: seriesName(r.version) }))
    : [{ ...latest, seriesName: null }];
  return {
    ...image,
    status: image.status ?? "stable",
    latest,
    previous,
    quick,
    builtAt,
    provenance: manifests[0] ?? null,
    signed: manifests.length > 0 && manifests.every((m) => m.signed),
    downloads: imageStats ? imageStats.total : null,
    versionsUrl: hasVersions ? versionsUrl : null,
    os_version: deriveOsVersion(image),
    // The image moves to new releases: its current release ending soon is not a warning.
    support: support && support.followsReleases ? { ...support, eolSoon: false } : support,
  };
}

const EOL_API = "https://endoflife.date/api/v1/products";
const eolCache = new Map<string, Promise<Record<string, unknown> | null>>();

/** One release of endoflife.date, or null (404, network, bad JSON): the support line is then left out. */
function fetchEolRelease(
  product: string,
  release: string,
): Promise<Record<string, unknown> | null> {
  const key = `${product}/${release}`;
  if (!eolCache.has(key)) {
    eolCache.set(
      key,
      (async () => {
        const target = `${EOL_API}/${encodeURIComponent(product)}/releases/${encodeURIComponent(release)}`;
        const res = await timedFetch(target, {
          headers: { "user-agent": "openimages.cloud-site" },
        });
        if (!res?.ok) {
          if (res) console.warn(`[eol] ${target} → HTTP ${res.status}`);
          return null;
        }
        try {
          return ((await res.json()) as { result?: Record<string, unknown> }).result ?? null;
        } catch {
          console.warn(`[eol] ${target} is not valid JSON`);
          return null;
        }
      })(),
    );
  }
  return eolCache.get(key)!;
}

const isoDate = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

export async function loadSupport(image: ImageEntry, now = new Date()): Promise<Support | null> {
  if (!image.eol) return null;
  const { product } = image.eol;
  const parts = image.latest_version
    .split(/[^0-9.]/)[0]
    .split(".")
    .filter(Boolean);
  const candidates = image.eol.release
    ? [image.eol.release]
    : [parts.slice(0, 2).join("."), parts[0]].filter((c, i, a) => c && a.indexOf(c) === i);
  for (const release of candidates) {
    const r = await fetchEolRelease(product, release);
    if (!r) continue;
    const securityUntil = isoDate(r.eolFrom);
    const activeUntil = isoDate(r.eoasFrom);
    const days = securityUntil
      ? (Date.parse(securityUntil) - now.getTime()) / 86_400_000
      : Infinity;
    return {
      product,
      release,
      activeUntil: activeUntil && activeUntil !== securityUntil ? activeUntil : null,
      securityUntil,
      extendedUntil: isoDate(r.eoesFrom),
      isEol: r.isEol === true,
      eolSoon: r.isEol !== true && days <= EOL_SOON_DAYS,
      followsReleases: !image.eol.release,
      sourceUrl: `https://endoflife.date/${product}`,
    };
  }
  console.warn(`[eol] ${image.os_name}: no ${product} release among ${candidates.join(", ")}`);
  return null;
}

/** "Active support until 9 Aug 2028, security support until 30 Jun 2030." */
export function supportText(s: Support, now = new Date()): string {
  const past = (d: string) => Date.parse(d) <= now.getTime();
  const out: string[] = [];
  if (s.isEol && s.securityUntil) out.push(`End of life since ${formatDate(s.securityUntil)}`);
  else {
    if (s.activeUntil)
      out.push(
        past(s.activeUntil)
          ? `Active support ended ${formatDate(s.activeUntil)}`
          : `Active support until ${formatDate(s.activeUntil)}`,
      );
    if (s.securityUntil)
      out.push(
        `${s.activeUntil ? "security support" : "Supported"} until ${formatDate(s.securityUntil)}`,
      );
  }
  if (s.extendedUntil && !past(s.extendedUntil))
    out.push(`paid extended support until ${formatDate(s.extendedUntil)}`);
  let text = out.join(", ");
  if (s.followsReleases)
    text = `Release ${s.release}: ${text[0].toLowerCase()}${text.slice(1)}; the image moves to each new release`;
  return text ? `${text}.` : "";
}

let cache: Promise<EnrichedImage[]> | null = null;

/** Loaded once per build and shared by every page. */
export function loadEnrichedImages(): Promise<EnrichedImage[]> {
  cache ??= loadDownloadStats().then((stats) =>
    Promise.all(loadImages().map((image) => enrichImage(image, stats))),
  );
  return cache;
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return "n/a";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 1234 → "1.2K"; null (stats unavailable) → "". */
export function formatCount(n: number | null | undefined): string {
  return n == null ? "" : compact.format(n);
}

/** Human label of the statistics window, e.g. "last 90 days" or "since Aug 13, 2026". */
export function downloadsWindowLabel(stats: DownloadStats): string {
  if (stats.window.startsWith("rolling-")) {
    return `last ${stats.window.replace(/^rolling-(\d+)d$/, "$1")} days`;
  }
  return `since ${formatDate(stats.since)}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "n/a"
    : d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

export function shortSha(sha: string | null | undefined, n = 7): string {
  return sha ? sha.replace(/^sha256:/, "").slice(0, n) : "n/a";
}
