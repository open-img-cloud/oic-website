/**
 * Build-time inputs of the command builders (src/lib/commands.ts): the same artifact, URL and
 * Glance properties as index.json, so every command matches the catalog.
 */
import { glanceProperties, minDiskGiB } from "~/lib/catalog-index";
import type { CmdArtifact, CmdImage } from "~/lib/commands";
import type { Artifact, EnrichedImage } from "~/lib/images";

/** Images oic-sync skips unless named, and syncs to OpenStack only (oic_sync.index). */
const OIC_SYNC_SERVICE_IMAGES = new Set([
  "octavia-amphora",
  "manila-service-image",
  "trove-guest-image",
  "cirros",
  "cloud-rescue",
]);

/** oic-sync release documented when PyPI does not answer at build time. */
export const OIC_SYNC_FALLBACK_VERSION = "0.1.1";

/**
 * Command inputs for one artifact. Without a manifest (not published yet, fetch failed), the
 * file name and the version directory stand in, as on the image page.
 */
export function cmdArtifact(image: EnrichedImage, a: Artifact | undefined): CmdArtifact {
  const sha256 = a?.manifest?.sha256 ?? null;
  return {
    variant: a?.variantId ?? null,
    label: a?.label ?? null,
    file: a?.filename ?? `${image.os_name}.qcow2`,
    url: a?.fileUrl ?? `https://images.openimages.cloud/${image.os_name}/${image.latest_version}/`,
    sha256,
    minDisk: minDiskGiB(a?.virtualSize),
    firmware: a?.firmware ?? "bios",
    glance: glanceProperties(image, {
      arch: a?.arch ?? "x86_64",
      firmware: a?.firmware ?? "bios",
      version: a?.manifest?.version ?? image.latest_version,
      sha256,
    }),
  };
}

/** First published artifact, the one the image page quick start uses. */
export function primaryArtifact(image: EnrichedImage): Artifact | undefined {
  return image.latest.artifacts.find((a) => a.fileUrl) ?? image.latest.artifacts[0];
}

export function cmdImage(image: EnrichedImage): CmdImage {
  const published = image.latest.artifacts.filter((a) => a.fileUrl);
  const artifacts = published.length
    ? published.map((a) => cmdArtifact(image, a))
    : [cmdArtifact(image, primaryArtifact(image))];
  return {
    id: image.os_name,
    title: image.title,
    latestVersion: image.latest_version,
    loginUser: image.login_user ?? null,
    testImage: !!image.test_image,
    serviceImage: OIC_SYNC_SERVICE_IMAGES.has(image.os_name),
    artifacts,
  };
}

let versionCache: Promise<string> | null = null;

async function fetchOicSyncVersion(): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch("https://pypi.org/pypi/oic-sync/json", {
      headers: { accept: "application/json", "user-agent": "openimages-ci" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const version = ((await res.json()) as { info?: { version?: string } }).info?.version;
    if (!version || !/^\d+(\.\d+)*$/.test(version))
      throw new Error(`unexpected version ${version}`);
    return version;
  } catch (err) {
    console.warn(
      `[commands] oic-sync version from PyPI unavailable (${(err as Error).message}), using ${OIC_SYNC_FALLBACK_VERSION}`,
    );
    return OIC_SYNC_FALLBACK_VERSION;
  } finally {
    clearTimeout(timer);
  }
}

/** Latest oic-sync release on PyPI, read once per build; the packages share its version. */
export function loadOicSyncVersion(): Promise<string> {
  versionCache ??= fetchOicSyncVersion();
  return versionCache;
}
