import type { APIRoute } from "astro";
import { buildIndex, buildOsismImages } from "~/lib/catalog-index";
import { loadEnrichedImages } from "~/lib/images";

export const prerender = true;

/** osism openstack-image-manager definitions, relayed as images.openimages.cloud/osism/images.yml. */
export const GET: APIRoute = async () => {
  const index = buildIndex(await loadEnrichedImages());
  return new Response(buildOsismImages(index), {
    headers: { "Content-Type": "application/yaml; charset=utf-8" },
  });
};
