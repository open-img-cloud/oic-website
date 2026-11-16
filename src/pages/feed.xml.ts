import type { APIRoute } from "astro";
import { GLOBAL_FEED_LIMIT, atom, feedEntries } from "~/lib/feeds";
import { loadEnrichedImages } from "~/lib/images";

export const prerender = true;

/** Every published version of the catalog, newest first. */
export const GET: APIRoute = async () => {
  const entries = (await feedEntries(await loadEnrichedImages())).slice(0, GLOBAL_FEED_LIMIT);
  return atom({
    id: "https://openimages.cloud/feed.xml",
    title: "Open Image Cloud: new image versions",
    subtitle: "Every signed, boot-tested cloud image version published by openimages.cloud.",
    selfUrl: "https://openimages.cloud/feed.xml",
    pageUrl: "https://openimages.cloud/images/",
    entries,
  });
};
