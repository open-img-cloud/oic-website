import type { APIRoute, GetStaticPaths } from "astro";
import { atom, feedEntries } from "~/lib/feeds";
import { type EnrichedImage, loadEnrichedImages } from "~/lib/images";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const images = await loadEnrichedImages();
  return images.map((image) => ({ params: { os: image.os_name }, props: { image } }));
};

/** Every published version of one image, newest first. */
export const GET: APIRoute = async ({ props }) => {
  const image = props.image as EnrichedImage;
  const url = `https://openimages.cloud/images/${image.os_name}/`;
  return atom({
    id: `${url}feed.xml`,
    title: `${image.title} images: new versions`,
    subtitle: `Signed, boot-tested ${image.title} cloud image versions published by openimages.cloud.`,
    selfUrl: `${url}feed.xml`,
    pageUrl: url,
    entries: await feedEntries([image]),
  });
};
