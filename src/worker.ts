interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const APEX_HOST = "openimages.cloud";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === `www.${APEX_HOST}`) {
      url.hostname = APEX_HOST;
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
