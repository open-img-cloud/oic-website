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
  featured?: boolean;
}

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
}

export interface Artifact {
  /** Variant label, or null for single-artifact images. */
  label: string | null;
  hint: string | null;
  filename: string | null;
  fileUrl: string | null;
  bundleUrl: string | null;
  manifestUrl: string;
  manifest: Manifest | null;
  sizeBytes: number | null;
  /** Downloads of this file (latest/ and versioned paths), null if stats are unavailable. */
  downloads: number | null;
}

export interface Release {
  version: string;
  artifacts: Artifact[];
}

export interface EnrichedImage extends ImageEntry {
  status: ImageStatus;
  latest: Release;
  previous: Release[];
  /** Most recent build time among the latest artifacts, if known. */
  builtAt: string | null;
  /** Manifest used for the provenance panel (first available latest artifact). */
  provenance: Manifest | null;
  signed: boolean;
  /** Downloads of every version of the image, null if stats are unavailable. */
  downloads: number | null;
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
  "^https://github.com/open-img-cloud/\\.github/\\.github/workflows/build-(libguestfs|dib|nix-flake)-image\\.yml@";
export const CERT_OIDC_ISSUER = "https://token.actions.githubusercontent.com";

const FETCH_TIMEOUT_MS = 8000;

export function loadImages(): ImageEntry[] {
  const doc = parseYaml(imagesYamlRaw) as { images: ImageEntry[] };
  const images = doc.images ?? [];
  return [...images].sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
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
    label: variant?.label ?? null,
    hint: variant?.hint ?? null,
    filename,
    fileUrl,
    bundleUrl: fileUrl ? `${fileUrl}.bundle` : null,
    manifestUrl,
    manifest,
    sizeBytes: fileUrl ? await fetchSize(fileUrl) : null,
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

export async function enrichImage(
  image: ImageEntry,
  stats: DownloadStats | null = null,
): Promise<EnrichedImage> {
  const [latest, previous] = await Promise.all([
    release(image, image.latest_version),
    // Previous releases are single-artifact (no variant matrix) in the catalog today.
    Promise.all((image.previous_versions ?? []).map((v) => release({ ...image, variants: [] }, v))),
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
  return {
    ...image,
    status: image.status ?? "stable",
    latest,
    previous,
    builtAt,
    provenance: manifests[0] ?? null,
    signed: manifests.length > 0 && manifests.every((m) => m.signed),
    downloads: imageStats ? imageStats.total : null,
  };
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
