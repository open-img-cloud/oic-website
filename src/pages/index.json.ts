import type { APIRoute } from "astro";
import { buildIndex } from "~/lib/catalog-index";
import { loadEnrichedImages } from "~/lib/images";

export const prerender = true;

/** Catalog index (oic-index/v1), relayed as https://images.openimages.cloud/index.json. */
export const GET: APIRoute = async () => {
  const index = buildIndex(await loadEnrichedImages());
  return new Response(`${JSON.stringify(index, null, 2)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
