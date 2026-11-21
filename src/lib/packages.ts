/**
 * Package manifests of the published images (<os>/<version>/packages.json, oic-packages/v1).
 *
 * Written after publication by the package-manifests workflow of open-img-cloud/.github, which
 * reads the image back from its bucket, checks its sha256 and lists the installed packages
 * with virt-inspector. The manifest is not signed itself: it records the sha256 of the image
 * it was taken from, checked here against the signed MANIFEST.
 */

export interface Pkg {
  name: string;
  version: string;
  arch: string | null;
}

export interface PackageDiff {
  previousVersion: string;
  added: Pkg[];
  removed: Pkg[];
  updated: { name: string; arch: string | null; from: string; to: string }[];
}

export interface PackageInfo {
  url: string;
  version: string;
  format: string | null;
  distro: string | null;
  generatedAt: string | null;
  packages: Pkg[];
  /** Changes since the previous build, null when it has no manifest. */
  diff: PackageDiff | null;
}

interface PackagesDoc {
  schema?: string;
  version?: string;
  source_sha256?: string;
  generated_at?: string;
  format?: string | null;
  distro?: string | null;
  packages?: Pkg[];
}

const TIMEOUT_MS = 15_000;
const cache = new Map<string, Promise<PackagesDoc | null>>();

function fetchDoc(url: string): Promise<PackagesDoc | null> {
  if (!cache.has(url)) {
    cache.set(
      url,
      (async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
          const res = await fetch(url, { signal: ctrl.signal });
          if (!res.ok) return null; // 404: no manifest (yet), not worth a warning
          const doc = (await res.json()) as PackagesDoc;
          return doc.schema === "oic-packages/v1" && Array.isArray(doc.packages) ? doc : null;
        } catch (err) {
          console.warn(`[packages] ${url}:`, (err as Error).message);
          return null;
        } finally {
          clearTimeout(timer);
        }
      })(),
    );
  }
  return cache.get(url)!;
}

export function manifestName(variant: string | null): string {
  return variant ? `packages-${variant}.json` : "packages.json";
}

const key = (p: Pkg) => `${p.name}\u0000${p.arch ?? ""}`;

export function diffPackages(previousVersion: string, before: Pkg[], after: Pkg[]): PackageDiff {
  const old = new Map(before.map((p) => [key(p), p]));
  const now = new Map(after.map((p) => [key(p), p]));
  const updated: PackageDiff["updated"] = [];
  for (const [k, p] of now) {
    const o = old.get(k);
    if (o && o.version !== p.version)
      updated.push({ name: p.name, arch: p.arch, from: o.version, to: p.version });
  }
  return {
    previousVersion,
    added: after.filter((p) => !old.has(key(p))),
    removed: before.filter((p) => !now.has(key(p))),
    updated,
  };
}

/** Newest other version of versions.json (by build date), or null. */
async function previousVersion(versionsUrl: string, latest: string): Promise<string | null> {
  try {
    const res = await fetch(versionsUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const doc = (await res.json()) as { versions?: { version?: string; built_at?: string }[] };
    const others = (doc.versions ?? [])
      .filter((v) => v.version && v.version !== latest)
      .sort((a, b) => (b.built_at ?? "").localeCompare(a.built_at ?? ""));
    return others[0]?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Packages of the latest version of an image, with the changes since the previous build.
 * `sha256` is the signed sha256 of the image (MANIFEST): a manifest taken from another file is
 * ignored.
 */
export async function loadPackages(opts: {
  base: string;
  osName: string;
  version: string;
  variant: string | null;
  sha256: string | null;
  versionsUrl: string | null;
}): Promise<PackageInfo | null> {
  const { base, osName, version, variant, sha256, versionsUrl } = opts;
  const url = `${base}/${osName}/${version}/${manifestName(variant)}`;
  const doc = await fetchDoc(url);
  if (!doc?.packages?.length) return null;
  if (sha256 && doc.source_sha256 && doc.source_sha256 !== sha256) {
    console.warn(`[packages] ${url} was taken from another file, ignored`);
    return null;
  }
  let diff: PackageDiff | null = null;
  const prev = versionsUrl ? await previousVersion(versionsUrl, version) : null;
  if (prev) {
    const before = await fetchDoc(`${base}/${osName}/${prev}/${manifestName(variant)}`);
    if (before?.packages?.length) diff = diffPackages(prev, before.packages, doc.packages);
  }
  return {
    url,
    version,
    format: doc.format ?? null,
    distro: doc.distro ?? null,
    generatedAt: doc.generated_at ?? null,
    packages: doc.packages,
    diff,
  };
}
