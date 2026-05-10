import { parse as parseYaml } from "yaml";
import imagesYamlRaw from "~/data/images.yaml?raw";

export interface Variant {
  id: string;
  label: string;
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
}

export interface Manifest {
  name: string;
  version: string;
  variant: string | null;
  format: string;
  filename: string;
  sha256: string;
  upstream?: string;
  built_at?: string;
  commit?: string;
  run_url?: string;
  builder_image?: string;
  builder_digest?: string;
  signed: boolean;
}

export interface EnrichedVariant {
  variant: Variant;
  manifest: Manifest | null;
  manifestUrl: string;
  fileUrl: string | null;
  filename: string | null;
}

export interface PreviousRelease {
  version: string;
  filename: string | null;
  fileUrl: string | null;
  manifestUrl: string;
  sha256: string | null;
  signed: boolean;
}

export interface EnrichedImage extends ImageEntry {
  enrichedVariants: EnrichedVariant[];
  enrichedManifest: Manifest | null;
  fileUrl: string | null;
  filename: string | null;
  previousReleases: PreviousRelease[];
}

const IMAGES_BASE_URL = (process.env.IMAGES_BASE_URL ?? "https://images.openimages.cloud").replace(
  /\/$/,
  "",
);
const FETCH_TIMEOUT_MS = 8000;

export function loadImages(): ImageEntry[] {
  const doc = parseYaml(imagesYamlRaw) as { images: ImageEntry[] };
  const images = doc.images ?? [];
  return [...images].sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
}

function manifestUrl(osName: string, version: string, variant?: Variant | null): string {
  const suffix = variant ? `MANIFEST-${variant.id}.json` : "MANIFEST.json";
  return `${IMAGES_BASE_URL}/${osName}/${version}/${suffix}`;
}

function fileUrlFor(osName: string, version: string, filename: string): string {
  return `${IMAGES_BASE_URL}/${osName}/${version}/${filename}`;
}

async function fetchManifest(url: string): Promise<Manifest | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[images] manifest fetch ${url} → HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as Manifest;
    return json;
  } catch (err) {
    console.warn(`[images] manifest fetch ${url} failed:`, (err as Error).message);
    return null;
  }
}

async function enrichPreviousReleases(
  osName: string,
  versions: string[] | undefined,
): Promise<PreviousRelease[]> {
  if (!versions || versions.length === 0) return [];
  return Promise.all(
    versions.map(async (version) => {
      const url = manifestUrl(osName, version, null);
      const manifest = await fetchManifest(url);
      const filename = manifest?.filename ?? null;
      return {
        version,
        filename,
        fileUrl: filename ? fileUrlFor(osName, version, filename) : null,
        manifestUrl: url,
        sha256: manifest?.sha256 ?? null,
        signed: manifest?.signed ?? false,
      };
    }),
  );
}

export async function enrichImage(image: ImageEntry): Promise<EnrichedImage> {
  const previousReleases = await enrichPreviousReleases(image.os_name, image.previous_versions);

  if (image.variants && image.variants.length > 0) {
    const enrichedVariants: EnrichedVariant[] = await Promise.all(
      image.variants.map(async (variant) => {
        const url = manifestUrl(image.os_name, image.latest_version, variant);
        const manifest = await fetchManifest(url);
        const filename =
          manifest?.filename ??
          variant.filename_template?.replaceAll("{version}", image.latest_version) ??
          null;
        return {
          variant,
          manifest,
          manifestUrl: url,
          filename,
          fileUrl: filename ? fileUrlFor(image.os_name, image.latest_version, filename) : null,
        };
      }),
    );
    return {
      ...image,
      enrichedVariants,
      enrichedManifest: null,
      fileUrl: null,
      filename: null,
      previousReleases,
    };
  }

  const url = manifestUrl(image.os_name, image.latest_version, null);
  const manifest = await fetchManifest(url);
  const filename = manifest?.filename ?? null;
  return {
    ...image,
    enrichedVariants: [],
    enrichedManifest: manifest,
    filename,
    fileUrl: filename ? fileUrlFor(image.os_name, image.latest_version, filename) : null,
    previousReleases,
  };
}

export async function loadEnrichedImages(): Promise<EnrichedImage[]> {
  const images = loadImages();
  return Promise.all(images.map(enrichImage));
}
