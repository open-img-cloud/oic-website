interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const APEX_HOST = "openimages.cloud";

// Sent on every response, including redirects. The site has no third-party
// scripts, fonts or frames; the inline scripts (theme, JSON-LD) need 'unsafe-inline'.
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; "),
};

function withSecurityHeaders(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // One canonical origin: https://openimages.cloud (www and plain http redirect to it).
    if (url.hostname === `www.${APEX_HOST}` || url.protocol === "http:") {
      url.hostname = APEX_HOST;
      url.protocol = "https:";
      return withSecurityHeaders(Response.redirect(url.toString(), 301));
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
