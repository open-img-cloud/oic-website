/**
 * Atom feeds of published versions, built from each bucket's versions.json (oic-versions/v1),
 * which lists every version that was published, with its build time and files.
 *   /feed.xml                    every image, newest first
 *   /images/<os>/feed.xml        one image
 */
import { IMAGES_BASE_URL, type EnrichedImage } from "~/lib/images";

const SITE = "https://openimages.cloud";
const TIMEOUT_MS = 15_000;
export const GLOBAL_FEED_LIMIT = 60;

interface VersionFile {
  variant: string | null;
  filename: string;
  sha256: string;
  size?: number | null;
  path: string;
}
interface VersionEntry {
  version: string;
  built_at: string;
  artifacts: VersionFile[];
}

export interface FeedEntry {
  image: EnrichedImage;
  version: string;
  builtAt: string;
  files: VersionFile[];
}

const cache = new Map<string, Promise<VersionEntry[]>>();

async function fetchVersions(os: string): Promise<VersionEntry[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${IMAGES_BASE_URL}/${os}/versions.json`, {
      headers: { "user-agent": "openimages-ci" },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { versions?: VersionEntry[] };
    return (data.versions ?? []).filter((v) => v.version && v.built_at);
  } catch (err) {
    console.warn(`[feeds] ${os}/versions.json unavailable:`, (err as Error).message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function versionsOf(os: string): Promise<VersionEntry[]> {
  let p = cache.get(os);
  if (!p) {
    p = fetchVersions(os);
    cache.set(os, p);
  }
  return p;
}

/** Published versions of the given images, newest first. */
export async function feedEntries(images: EnrichedImage[]): Promise<FeedEntry[]> {
  const lists = await Promise.all(
    images.map(async (image) =>
      (await versionsOf(image.os_name)).map((v) => ({
        image,
        version: v.version,
        builtAt: v.built_at,
        files: v.artifacts ?? [],
      })),
    ),
  );
  return lists.flat().sort((a, b) => b.builtAt.localeCompare(a.builtAt));
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mib = (n?: number | null) => (n ? `${Math.round(n / 1048576)} MiB` : "");

function entryXml(e: FeedEntry): string {
  const page = `${SITE}/images/${e.image.os_name}/`;
  const items = e.files
    .map(
      (f) =>
        `<li><a href="${esc(`${IMAGES_BASE_URL}/${e.image.os_name}/${f.path}`)}">${esc(f.filename)}</a>` +
        `${f.size ? ` (${mib(f.size)})` : ""}<br>sha256 <code>${esc(f.sha256)}</code></li>`,
    )
    .join("");
  const html =
    `<p>${esc(e.image.title)} ${esc(e.version)} is published: built from the official upstream ` +
    `image, signed with Sigstore cosign and boot-tested on OpenStack.</p><ul>${items}</ul>` +
    `<p><a href="${page}">Catalog page</a> · <a href="${SITE}/verify/">Verify the signature</a></p>`;
  return `  <entry>
    <id>tag:openimages.cloud,2026:${esc(e.image.os_name)}/${esc(e.version)}</id>
    <title>${esc(`${e.image.title} ${e.version}`)}</title>
    <link rel="alternate" type="text/html" href="${page}"/>
    <updated>${esc(e.builtAt)}</updated>
    <published>${esc(e.builtAt)}</published>
    <category term="${esc(e.image.os_name)}"/>
    <content type="html">${esc(html)}</content>
  </entry>`;
}

export function atom(opts: {
  id: string;
  title: string;
  subtitle: string;
  selfUrl: string;
  pageUrl: string;
  entries: FeedEntry[];
}): Response {
  const updated = opts.entries[0]?.builtAt ?? new Date(0).toISOString();
  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(opts.id)}</id>
  <title>${esc(opts.title)}</title>
  <subtitle>${esc(opts.subtitle)}</subtitle>
  <link rel="self" type="application/atom+xml" href="${esc(opts.selfUrl)}"/>
  <link rel="alternate" type="text/html" href="${esc(opts.pageUrl)}"/>
  <updated>${esc(updated)}</updated>
  <author><name>Open Image Cloud</name><uri>${SITE}/</uri></author>
  <icon>${SITE}/favicon-32.png</icon>
${opts.entries.map(entryXml).join("\n")}
</feed>
`;
  return new Response(body, { headers: { "Content-Type": "application/atom+xml; charset=utf-8" } });
}
