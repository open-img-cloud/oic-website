/**
 * Machine-readable exports of the catalog, generated at build time:
 *
 * - /index.json (schema oic-index/v1): latest version of every image, with versioned URLs,
 *   digests, sizes and the cosign identity. Relayed as images.openimages.cloud/index.json by
 *   the images-router Worker.
 * - /osism/images.yml: the same images in the osism openstack-image-manager format.
 *
 * Both only add fields over time; a breaking change bumps the schema to oic-index/v2.
 */
import { stringify } from "yaml";
import {
  CERT_IDENTITY_REGEXP,
  CERT_OIDC_ISSUER,
  IMAGES_BASE_URL,
  type EnrichedImage,
  type Firmware,
} from "~/lib/images";

export const INDEX_SCHEMA = "oic-index/v1";

/**
 * Glance properties every catalog image supports, overridable per image in images.yaml
 * (glance_properties). All images ship qemu-guest-agent, virtio-scsi and multiqueue-capable
 * virtio-net drivers; os_require_quiesce makes Nova freeze the filesystems through the agent
 * before a snapshot.
 */
export const DEFAULT_GLANCE_PROPERTIES: Record<string, string> = {
  hw_qemu_guest_agent: "yes",
  hw_disk_bus: "scsi",
  hw_scsi_model: "virtio-scsi",
  hw_vif_multiqueue_enabled: "true",
  os_require_quiesce: "yes",
};

/**
 * Glance os_type (Nova knows "linux" and "windows" only): set for Linux and Windows images,
 * left out for the BSDs rather than calling them Linux.
 */
const NON_LINUX_DISTROS = new Set(["freebsd", "openbsd", "netbsd", "dragonfly"]);
export function osType(osDistro: string | null | undefined): string | null {
  if (osDistro === "windows") return "windows";
  if (osDistro && NON_LINUX_DISTROS.has(osDistro)) return null;
  return "linux";
}

/** { os_type } to spread into a property set, or nothing for the BSDs. */
export function glanceOsType(osDistro: string | null | undefined): Record<string, string> {
  const type = osType(osDistro);
  return type ? { os_type: type } : {};
}

/**
 * Supported by every image but left to the operator: on some clouds the flavor must allow it
 * (hw_rng:allowed=True) or Nova refuses to boot.
 */
export const OPTIONAL_GLANCE_PROPERTIES: Record<string, string> = {
  hw_rng_model: "virtio",
};

/** Keys of the osism image meta schema we may pass through (it rejects unknown keys). */
const OSISM_META_KEYS = new Set([
  "os_type",
  "os_admin_user",
  "hw_qemu_guest_agent",
  "hw_disk_bus",
  "hw_scsi_model",
  "hw_vif_multiqueue_enabled",
  "hw_rng_model",
  "hw_firmware_type",
  "hw_machine_type",
]);

interface GlanceImageInput {
  os_name: string;
  os_distro?: string | null;
  os_version?: string | null;
  login_user?: string | null;
  glance_properties?: Record<string, string>;
  os_purpose?: string;
  replace_frequency?: string;
  openstack_series?: boolean;
  support?: { securityUntil: string | null } | null;
}

interface GlanceArtifactInput {
  arch: string;
  firmware: Firmware;
  version: string;
  sha256?: string | null;
  /** Versioned download URL (SCS-0102 image_source). */
  url?: string | null;
  /** Build time from the manifest (SCS-0102 image_build_date). */
  built_at?: string | null;
  /**
   * The image's primary artifact. Other variants of the same OS, version and architecture
   * (Alpine UEFI, Alpaquita musl) are os_purpose=custom: SCS-0102 allows one generic image per
   * (os_distro, os_version, architecture).
   */
  primary?: boolean;
}

/** How long an image stays referable by UUID after a newer one replaces it (oic-sync keeps 3). */
export const UUID_VALIDITY = "last-3";

/**
 * SCS-0102 v2 metadata (https://docs.scs.community/standards/scs-0102-v2-image-metadata):
 * login user, source URL, build date, description, purpose, replacement commitment, support
 * end and UUID validity.
 */
export function scsProperties(
  img: GlanceImageInput,
  a: GlanceArtifactInput,
): Record<string, string> {
  const purpose =
    a.primary === false
      ? "custom"
      : (img.os_purpose ?? (img.openstack_series ? "custom" : "generic"));
  return {
    image_original_user: img.login_user || "none",
    ...(a.url && { image_source: a.url }),
    ...(a.built_at && { image_build_date: a.built_at }),
    image_description: `https://openimages.cloud/images/${img.os_name}/`,
    os_purpose: purpose,
    replace_frequency: img.replace_frequency ?? "critical_bug",
    provided_until: img.support?.securityUntil ?? "none",
    uuid_validity: UUID_VALIDITY,
  };
}

/**
 * Full Glance property set for one artifact, shared by the image page snippet and index.json:
 * OS identity, defaults, firmware, and oic_* keys that let tools recognise our images in Glance
 * and detect a newer version.
 */
export function glanceProperties(
  img: GlanceImageInput,
  a: GlanceArtifactInput,
): Record<string, string> {
  return {
    ...glanceOsType(img.os_distro),
    ...(img.os_distro && { os_distro: img.os_distro }),
    ...(img.os_version && { os_version: img.os_version }),
    ...(img.login_user && { os_admin_user: img.login_user }),
    architecture: a.arch,
    ...DEFAULT_GLANCE_PROPERTIES,
    ...firmwareProperties(a.firmware),
    ...scsProperties(img, a),
    ...img.glance_properties,
    oic_id: img.os_name,
    oic_version: a.version,
    ...(a.sha256 && { oic_sha256: a.sha256 }),
  };
}

/** Glance properties a UEFI artifact needs on top of the image ones. */
export function firmwareProperties(firmware: Firmware): Record<string, string> {
  return firmware === "uefi" ? { hw_firmware_type: "uefi", hw_machine_type: "q35" } : {};
}

/** Smallest root disk (GiB, rounded up) that fits the image, null when the size is unknown. */
export function minDiskGiB(virtualSize: number | null | undefined): number | null {
  return virtualSize ? Math.ceil(virtualSize / 2 ** 30) : null;
}

export interface IndexArtifact {
  variant: string | null;
  version: string;
  arch: string;
  format: string;
  firmware: Firmware;
  url: string;
  sha256: string;
  sha512: string | null;
  size: number | null;
  virtual_size: number | null;
  bundle_url: string | null;
  manifest_url: string;
  built_at: string | null;
  build_url: string | null;
  commit: string | null;
  signed: boolean;
  /** Complete property set to pass to `openstack image create` for this artifact. */
  glance_properties: Record<string, string>;
}

export interface IndexImage {
  id: string;
  title: string;
  status: string;
  status_note: string | null;
  /** Support dates from endoflife.date at build time (ISO dates), null when unknown. */
  support: {
    product: string;
    release: string;
    active_until: string | null;
    security_until: string | null;
    extended_until: string | null;
    is_eol: boolean;
    eol_soon: boolean;
    follows_releases: boolean;
    source: string;
  } | null;
  repo: string;
  login_user: string | null;
  os_distro: string | null;
  os_version: string | null;
  latest_version: string;
  versions_url: string | null;
  /** Installed packages of the latest version (oic-packages/v1), null when not published yet. */
  packages_url: string | null;
  tags: string[];
  glance_properties: Record<string, string>;
  optional_glance_properties: Record<string, string>;
  artifacts: IndexArtifact[];
}

export interface CatalogIndex {
  schema: typeof INDEX_SCHEMA;
  generated_at: string;
  base_url: string;
  signing: {
    type: "cosign-keyless";
    bundle_format: "sigstore-bundle";
    certificate_identity_regexp: string;
    certificate_oidc_issuer: string;
  };
  images: IndexImage[];
}

function indexImage(image: EnrichedImage): IndexImage | null {
  const artifacts: IndexArtifact[] = [];
  for (const a of image.latest.artifacts) {
    const m = a.manifest;
    const primary = artifacts.length === 0;
    // Only artifacts whose manifest was fetched: they carry the digest and the versioned URL.
    if (!m || !a.fileUrl) continue;
    artifacts.push({
      variant: a.variantId,
      version: m.version,
      arch: a.arch,
      format: m.format,
      firmware: a.firmware,
      url: a.fileUrl,
      sha256: m.sha256,
      sha512: m.sha512 ?? null,
      size: a.sizeBytes,
      virtual_size: a.virtualSize,
      bundle_url: a.bundleUrl,
      manifest_url: a.manifestUrl,
      built_at: m.built_at ?? null,
      build_url: m.build_url ?? null,
      commit: m.commit ?? null,
      signed: m.signed,
      glance_properties: glanceProperties(image, {
        arch: a.arch,
        firmware: a.firmware,
        version: m.version,
        sha256: m.sha256,
        url: a.fileUrl,
        built_at: m.built_at ?? null,
        primary,
      }),
    });
  }
  if (artifacts.length === 0) return null;
  return {
    id: image.os_name,
    title: image.title,
    status: image.status,
    status_note: image.status_note ?? null,
    support: image.support && {
      product: image.support.product,
      release: image.support.release,
      active_until: image.support.activeUntil,
      security_until: image.support.securityUntil,
      extended_until: image.support.extendedUntil,
      is_eol: image.support.isEol,
      eol_soon: image.support.eolSoon,
      follows_releases: image.support.followsReleases,
      source: image.support.sourceUrl,
    },
    repo: `https://github.com/${image.repo}`,
    login_user: image.login_user ?? null,
    os_distro: image.os_distro ?? null,
    os_version: image.os_version,
    latest_version: image.latest_version,
    versions_url: image.versionsUrl,
    packages_url: image.packages?.url ?? null,
    tags: image.tags,
    glance_properties: {
      ...glanceOsType(image.os_distro),
      ...(image.login_user && { os_admin_user: image.login_user }),
      ...DEFAULT_GLANCE_PROPERTIES,
      ...image.glance_properties,
    },
    optional_glance_properties: OPTIONAL_GLANCE_PROPERTIES,
    artifacts,
  };
}

/** Preview images are left out: the index lists what we recommend to import. */
export function buildIndex(images: EnrichedImage[], now = new Date()): CatalogIndex {
  return {
    schema: INDEX_SCHEMA,
    generated_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    base_url: IMAGES_BASE_URL,
    signing: {
      type: "cosign-keyless",
      bundle_format: "sigstore-bundle",
      certificate_identity_regexp: CERT_IDENTITY_REGEXP,
      certificate_oidc_issuer: CERT_OIDC_ISSUER,
    },
    images: images
      .filter((image) => image.status !== "preview")
      .map(indexImage)
      .filter((image): image is IndexImage => !!image),
  };
}

/**
 * os_distro values accepted by the osism schema (etc/schema.yaml, libosinfo names) that the
 * catalog uses. Images with another value (amzn, alpaquita) would make
 * `openstack-image-manager --check` reject the whole file, so they are left out.
 */
const OSISM_OS_DISTROS = new Set([
  "almalinux",
  "alpinelinux",
  "arch",
  "centos",
  "debian",
  "fedora",
  "freebsd",
  "gentoo",
  "nixos",
  "ol",
  "opensuse",
  "rocky",
  "ubuntu",
]);

/** Images with a dedicated workflow, not meant for a generic image sync. */
const OSISM_EXCLUDED = new Set([
  // Octavia amphora: service image owned by the octavia project and tagged for
  // [controller_worker] amp_image_tag; import it with the Octavia procedure instead.
  "octavia-amphora",
  // Manila service image: booted by the Manila generic driver (service_image_name), not by tenants.
  "manila-service-image",
  // Trove guest image: booted by Trove for database instances, not by tenants.
  "trove-guest-image",
  // CirrOS: test image, osism ships its own definition (os_purpose minimal, min_ram 64).
  "cirros",
  // Cloud Rescue: used with `openstack server rescue`, not booted as a workload.
  "cloud-rescue",
]);

/** Whether an image is part of the osism export. */
export function inOsismExport(id: string, osDistro: string | null | undefined): boolean {
  return !OSISM_EXCLUDED.has(id) && !!osDistro && OSISM_OS_DISTROS.has(osDistro);
}

function osismDay(iso: string | null): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : new Date(d.toISOString().slice(0, 10));
}

/** Artifact Glance properties reduced to what the osism schema accepts, with its types. */
function osismMeta(props: Record<string, string>): Record<string, string | boolean> {
  const meta: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!OSISM_META_KEYS.has(k)) continue;
    meta[k] = k === "hw_vif_multiqueue_enabled" ? v === "true" : v;
  }
  return meta;
}

/**
 * osism openstack-image-manager definitions (github.com/osism/openstack-image-manager,
 * etc/schema.yaml and etc/images/*.yml): one image per artifact, `multi: true` so the latest
 * version keeps the stable name and older ones are renamed "<name> (<version>)".
 * The schema rejects unknown meta keys: image_source and image_build_date are set by the
 * manager from versions[].url and build_date, and min_disk, when unknown here, from the
 * virtual size Glance reports after the import.
 */
export function buildOsismImages(index: CatalogIndex): string {
  const images = index.images
    .filter((img) => inOsismExport(img.id, img.os_distro))
    .flatMap((img) =>
      img.artifacts.map((a) => {
        const variantLabel = img.artifacts.length > 1 && a.variant ? a.variant : null;
        const minDisk = minDiskGiB(a.virtual_size);
        return {
          name: variantLabel ? `${img.title} (${variantLabel.toUpperCase()})` : img.title,
          enable: true,
          shortname: variantLabel ? `${img.id}-${variantLabel}` : img.id,
          format: a.format,
          login: img.login_user ?? "root",
          ...(minDisk != null && { min_disk: minDisk }),
          min_ram: 512,
          status: "active",
          visibility: "public",
          multi: true,
          meta: {
            architecture: a.arch,
            hypervisor_type: "qemu",
            ...osismMeta(a.glance_properties),
            os_distro: img.os_distro,
            ...(img.os_version && { os_version: img.os_version }),
            os_purpose: "generic",
            provided_until: "none",
            replace_frequency: "quarterly",
            uuid_validity: "none",
            image_description: `${img.title}, signed cloud image from ${index.base_url}`,
          },
          tags: ["oic"],
          versions: [
            {
              version: a.version,
              url: a.url,
              checksum: `sha256:${a.sha256}`,
              ...(osismDay(a.built_at) && { build_date: osismDay(a.built_at) }),
            },
          ],
        };
      }),
    );
  const header = [
    "# openimages.cloud images for osism openstack-image-manager",
    "# (https://github.com/osism/openstack-image-manager), generated from",
    `# ${index.base_url}/index.json (${index.schema}) at ${index.generated_at}.`,
    "#",
    "#   curl -fsSo /etc/oic-images.yml https://images.openimages.cloud/osism/images.yml",
    "#   openstack-image-manager --cloud admin --images /etc/oic-images.yml --latest",
    "#",
    "# Left out: octavia-amphora, manila-service-image and trove-guest-image (service",
    "# images, import them with the Octavia, Manila or Trove procedure),",
    "# and images whose os_distro is not in the osism schema (Amazon Linux, Alpaquita).",
    "# Checksums are sha256 from the signed MANIFEST; cosign signatures are not verified",
    "# by the image manager (see https://openimages.cloud/verify/).",
    "",
  ].join("\n");
  // YAML 1.1 output, as read by PyYAML: quoted "yes" and version strings, plain dates.
  return header + stringify({ images }, { version: "1.1", lineWidth: 0 });
}
