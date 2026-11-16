/**
 * Ready-to-copy commands for one image artifact: the image page quick start and the command
 * generator (/get/) share these builders. Pure functions, no Node APIs: the /get/ page script
 * imports them in the browser too.
 */

export const TARGETS = [
  { id: "openstack", label: "OpenStack CLI" },
  { id: "oic-sync-openstack", label: "oic-sync for OpenStack" },
  { id: "proxmox", label: "Proxmox VE (qm)" },
  { id: "oic-sync-proxmox", label: "oic-sync for Proxmox VE" },
  { id: "terraform", label: "Terraform / OpenTofu" },
  { id: "cloud-init", label: "cloud-init user-data" },
] as const;

export type TargetId = (typeof TARGETS)[number]["id"];

export const VISIBILITIES = ["private", "shared", "community", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** How oic-sync gets installed on a Proxmox VE node. */
export const PVE_INSTALLS = [
  { id: "deb13", label: "Debian package, Proxmox VE 9" },
  { id: "deb12", label: "Debian package, Proxmox VE 8" },
  { id: "pipx", label: "pipx" },
] as const;
export type PveInstall = (typeof PVE_INSTALLS)[number]["id"];

export interface CmdArtifact {
  /** Variant id, null for single-artifact images. */
  variant: string | null;
  label: string | null;
  file: string;
  /** Versioned URL of the file (never latest/). */
  url: string;
  sha256: string | null;
  minDisk: number | null;
  firmware: "uefi" | "bios";
  /** Glance properties of this artifact, exactly those of index.json. */
  glance: Record<string, string>;
}

export interface CmdImage {
  id: string;
  title: string;
  latestVersion: string;
  loginUser: string | null;
  /** Upstream test image (CirrOS): no cloud-init, no Proxmox template. */
  testImage: boolean;
  /** Skipped by oic-sync unless named; only synced to OpenStack. */
  serviceImage: boolean;
  artifacts: CmdArtifact[];
}

export interface CmdOptions {
  /** Glance image name, or VM name for qm; empty: the default one. */
  name: string;
  /** clouds.yaml cloud name; empty: none (OS_CLOUD or OS_* variables). */
  cloud: string;
  /** Empty: the tool default. */
  visibility: Visibility | "";
  vmid: number;
  storage: string;
  pveInstall: PveInstall;
  user: string;
  sshKey: string;
}

export const DEFAULT_OPTIONS: CmdOptions = {
  name: "",
  cloud: "mycloud",
  visibility: "",
  vmid: 9000,
  storage: "local-lvm",
  pveInstall: "deb13",
  user: "ops",
  sshKey: "ssh-ed25519 AAAA... you@example.com",
};

export interface CmdBlock {
  label: string;
  code: string;
}

/** Quotes a value for a POSIX shell when it needs it. */
export function shq(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Name of the image in Glance by default: debian-13-13-20261103-2651, alpine-linux-...-uefi. */
export function defaultGlanceName(image: CmdImage, a: CmdArtifact): string {
  return `${image.id}-${image.latestVersion}${a.label ? `-${a.label.toLowerCase()}` : ""}`;
}

/** Name oic-sync gives the newest version (oic_sync.index.stable_name). */
export function oicSyncStableName(image: CmdImage, a: CmdArtifact): string {
  return a.variant && image.artifacts.length > 1
    ? `${image.title} (${a.variant.toUpperCase()})`
    : image.title;
}

export function openstackCli(
  image: CmdImage,
  a: CmdArtifact,
  opts: Pick<CmdOptions, "name" | "cloud" | "visibility"> = {
    name: "",
    cloud: "",
    visibility: "",
  },
): string {
  const name = opts.name.trim() || defaultGlanceName(image, a);
  const cloud = opts.cloud.trim();
  return `${cloud ? `export OS_CLOUD=${shq(cloud)}\n` : ""}curl -fLO ${a.url}${a.sha256 ? `\necho "${a.sha256}  ${a.file}" | sha256sum -c -` : ""}

openstack image create \\
  --disk-format qcow2 --container-format bare \\
  --file ${a.file} \\${a.minDisk ? `\n  --min-disk ${a.minDisk} \\` : ""}${opts.visibility ? `\n  --${opts.visibility} \\` : ""}
${Object.entries(a.glance)
  .map(([k, v]) => `  --property ${k}=${v} \\`)
  .join("\n")}
  ${shq(name)}`;
}

export function proxmoxQm(
  image: CmdImage,
  a: CmdArtifact,
  opts: Pick<CmdOptions, "name" | "vmid" | "storage"> = {
    name: "",
    vmid: 9000,
    storage: "local-lvm",
  },
): string {
  const vmid = opts.vmid;
  const storage = opts.storage.trim() || "local-lvm";
  const name = opts.name.trim() || image.id;
  const uefi =
    a.firmware === "uefi"
      ? ` \\\n  --bios ovmf --machine q35 --efidisk0 ${storage}:0,efitype=4m`
      : "";
  return `# Download into the "import" content of a file storage; PVE checks the sha256.
pvesh create /nodes/$(hostname)/storage/local/download-url \\
  --content import --filename ${a.file} \\
  --url ${a.url}${a.sha256 ? ` \\\n  --checksum ${a.sha256} --checksum-algorithm sha256` : ""}

qm create ${vmid} --name ${shq(name)} --memory 2048 --cores 2 \\
  --net0 virtio,bridge=vmbr0 --scsihw virtio-scsi-single \\
  --serial0 socket --vga serial0 --agent enabled=1${uefi}
qm set ${vmid} --scsi0 ${storage}:0,import-from=local:import/${a.file},discard=on
qm set ${vmid} --ide2 ${storage}:cloudinit --boot order=scsi0${
    image.loginUser ? ` \\\n  --ciuser ${image.loginUser}` : ""
  } --sshkeys ~/.ssh/id_ed25519.pub --ipconfig0 ip=dhcp
qm template ${vmid}`;
}

function variantFlag(image: CmdImage, a: CmdArtifact): string {
  return image.artifacts.length > 1 && a.variant ? ` --variant ${a.variant}` : "";
}

export function oicSyncOpenstack(image: CmdImage, a: CmdArtifact, opts: CmdOptions): string {
  const cloud = opts.cloud.trim();
  const args = `--image ${image.id}${variantFlag(image, a)}${cloud ? ` --cloud ${shq(cloud)}` : ""}${
    opts.visibility ? ` --visibility ${opts.visibility}` : ""
  }`;
  return `pipx install 'oic-sync[openstack]'
${cloud ? "" : "# No --cloud: credentials come from $OS_CLOUD or the OS_* variables\n"}
# Show what a sync would do (read only, signatures verified)
oic-sync openstack sync ${args} --dry-run
# Import the latest version as "${oicSyncStableName(image, a)}"${opts.visibility ? "" : " (private by default)"}; run it
# daily: new versions take that name, older ones are renamed, 2 are kept (--keep)
oic-sync openstack sync ${args}
# Compare the cloud with the index (read only)
oic-sync openstack status ${args.replace(/ --visibility \S+/, "")}`;
}

export function oicSyncReleaseAsset(version: string, install: "deb13" | "deb12"): string {
  return `oic-sync_${version}-1.${install}_amd64.deb`;
}

export function oicSyncReleaseUrl(version: string, asset: string): string {
  return `https://github.com/open-img-cloud/oic-sync/releases/download/v${version}/${asset}`;
}

export function oicSyncProxmox(
  image: CmdImage,
  a: CmdArtifact,
  opts: CmdOptions,
  oicSyncVersion: string,
): string {
  const storage = opts.storage.trim() || "local-lvm";
  const args = `--image ${image.id}${variantFlag(image, a)} --vmid-base ${opts.vmid} --disk-storage ${shq(storage)}`;
  let install: string;
  let daily: string;
  if (opts.pveInstall === "pipx") {
    install = `apt install pipx
pipx install oic-sync`;
    daily = `# Daily: run the same command from a systemd timer, see
# https://openimages.cloud/oic-sync/proxmox/`;
  } else {
    const asset = oicSyncReleaseAsset(oicSyncVersion, opts.pveInstall);
    install = `# On the node, as root (package with a systemd service and timer)
curl -fLO ${oicSyncReleaseUrl(oicSyncVersion, asset)}
apt install ./${asset}`;
    daily = `# Daily: set the options in /etc/default/oic-sync, then enable the timer
#   OIC_SYNC_PROXMOX_ARGS="${args}"
systemctl enable --now oic-sync-proxmox.timer`;
  }
  return `${install}

# Downloads go to the "import" content of a file storage: enable it once
# (list the content types the storage already has, plus import)
pvesm set local --content iso,vztmpl,backup,import

# Show what a sync would do (read only, signatures verified)
oic-sync proxmox sync ${args} --dry-run
# Create the template, on the first free VMID from ${opts.vmid}
oic-sync proxmox sync ${args}

${daily}`;
}

/** Terraform identifier: debian-13 gives debian_13, ubuntu-24.04 gives ubuntu_24_04. */
function tfName(image: CmdImage, a: CmdArtifact): string {
  const base = `${image.id}${image.artifacts.length > 1 && a.variant ? `-${a.variant}` : ""}`;
  return base.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
}

function hcl(value: string): string {
  return JSON.stringify(value);
}

export function terraform(image: CmdImage, a: CmdArtifact, opts: CmdOptions): string {
  const id = tfName(image, a);
  const name = opts.name.trim() || defaultGlanceName(image, a);
  const multi = image.artifacts.length > 1 && a.variant;
  // oic_variant: the property oic-sync sets on multi-variant images, so one lookup finds the
  // image whether Terraform or oic-sync imported it.
  const glance: Record<string, string> = multi
    ? { ...a.glance, oic_variant: String(a.variant) }
    : a.glance;
  const width = Math.max(...Object.keys(glance).map((k) => k.length));
  const props = Object.entries(glance)
    .map(([k, v]) => `    ${k.padEnd(width)} = ${hcl(v)}`)
    .join("\n");
  const rows: [string, string][] = [
    ["name", hcl(name)],
    ["image_source_url", hcl(a.url)],
    ["container_format", hcl("bare")],
    ["disk_format", hcl("qcow2")],
    ...(a.minDisk ? [["min_disk_gb", String(a.minDisk)] as [string, string]] : []),
    ...(opts.visibility ? [["visibility", hcl(opts.visibility)] as [string, string]] : []),
  ];
  const rowWidth = Math.max(...rows.map(([k]) => k.length));
  return `# Provider: terraform-provider-openstack/openstack. Terraform downloads the file and
# uploads it to Glance; check its signature first (https://openimages.cloud/verify/).
resource "openstack_images_image_v2" "${id}" {
${rows.map(([k, v]) => `  ${k.padEnd(rowWidth)} = ${v}`).join("\n")}
  # web_download = true  # let Glance fetch the URL itself, if the cloud allows it

  properties = {
${props}
  }
}

# Consumers in other configurations: look the image up by property, not by name, and
# ignore image changes on long-lived servers (lifecycle ignore_changes).
data "openstack_images_image_v2" "${id}" {
  properties  = { oic_id = ${hcl(image.id)}${multi ? `, oic_variant = ${hcl(String(a.variant))}` : ""} }
  most_recent = true
}`;
}

export function cloudInitUserData(image: CmdImage, opts: CmdOptions): string {
  const user = opts.user.trim() || "ops";
  const key = opts.sshKey.trim() || DEFAULT_OPTIONS.sshKey;
  return `#cloud-config
# Adds the user ${user} with your SSH key${image.loginUser ? `; the default user (${image.loginUser}) keeps working` : ""}.
users:
  - default
  - name: ${user}
    lock_passwd: true
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    ssh_authorized_keys:
      - ${key}`;
}

export function cloudInitUsage(image: CmdImage, a: CmdArtifact, opts: CmdOptions): string {
  const glanceName = opts.name.trim() || defaultGlanceName(image, a);
  return `# OpenStack: pass the file at boot (adjust the flavor and network)
openstack server create --image ${shq(glanceName)} \\
  --flavor m1.small --network private \\
  --user-data user-data.yaml vm1

# Proxmox VE: the "local" storage needs the Snippets content type.
# A custom user-data replaces the one built from --ciuser and --sshkeys.
cp user-data.yaml /var/lib/vz/snippets/
qm clone ${opts.vmid} 120 --name vm1 --full 0
qm set 120 --cicustom "user=local:snippets/user-data.yaml"
qm start 120`;
}

export interface TargetResult {
  /** Why the target does not apply to this image; null when it does. */
  unavailable: string | null;
  blocks: CmdBlock[];
}

/** Commands of one target, as shown by /get/. */
export function generate(
  target: TargetId,
  image: CmdImage,
  a: CmdArtifact,
  opts: CmdOptions,
  oicSyncVersion: string,
): TargetResult {
  const none = (why: string): TargetResult => ({ unavailable: why, blocks: [] });
  switch (target) {
    case "openstack":
      return {
        unavailable: null,
        blocks: [{ label: "OpenStack Glance", code: openstackCli(image, a, opts) }],
      };
    case "oic-sync-openstack":
      return {
        unavailable: null,
        blocks: [{ label: "oic-sync", code: oicSyncOpenstack(image, a, opts) }],
      };
    case "proxmox":
      if (image.testImage)
        return none(
          `${image.title} ignores the Proxmox cloud-init drive: boot the disk and log in on the console with its well-known password.`,
        );
      return {
        unavailable: null,
        blocks: [{ label: "Proxmox VE 9", code: proxmoxQm(image, a, opts) }],
      };
    case "oic-sync-proxmox":
      if (image.testImage || image.serviceImage)
        return none(`oic-sync handles ${image.title} on OpenStack only.`);
      return {
        unavailable: null,
        blocks: [
          {
            label: "oic-sync on a Proxmox VE node",
            code: oicSyncProxmox(image, a, opts, oicSyncVersion),
          },
        ],
      };
    case "terraform":
      return { unavailable: null, blocks: [{ label: "hcl", code: terraform(image, a, opts) }] };
    case "cloud-init":
      if (image.testImage)
        return none(`${image.title} has no cloud-init: it reads only its own metadata.`);
      return {
        unavailable: null,
        blocks: [
          { label: "user-data.yaml", code: cloudInitUserData(image, opts) },
          { label: "bash", code: cloudInitUsage(image, a, opts) },
        ],
      };
  }
}
