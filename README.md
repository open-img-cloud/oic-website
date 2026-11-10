# oic-website

Public website for the [Open Image Cloud](https://github.com/open-img-cloud) project — landing page and image catalog, served at <https://openimages.cloud>.

## What

Static site built with [Astro](https://astro.build):

- **Landing**: project pitch, links to the GitHub org and the public image registry.
- **Catalog**: list of published cloud images (Alpaquita, Octavia Amphora, ...) with versions, checksums, signatures and usage examples. Generated at build time from a curated `src/data/images.yaml` enriched with each image's published `MANIFEST.json` (fetched from `https://images.openimages.cloud`).

## Run

Prerequisites:

- Node (pinned in `.nvmrc`), managed via [`fnm`](https://github.com/Schniz/fnm).
- [`pnpm`](https://pnpm.io) (via Corepack: `corepack enable && corepack prepare pnpm@latest --activate`).
- [`direnv`](https://direnv.net) recommended — `.envrc` activates the right Node version automatically.

```bash
direnv allow         # first time only
pnpm install
pnpm dev             # http://localhost:4321
```

## Test

```bash
pnpm check           # astro check (type checking)
pnpm lint            # eslint
pnpm format:check    # prettier
pnpm build           # production build into ./dist
```

## Deploy

The site is deployed to [Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/) (Static Assets, `wrangler.toml`) by the `deploy.yml` workflow: on push to `main`, daily (to refresh the catalog from published `MANIFEST.json` files), and on demand. It needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. Pull requests are built by `ci.yml` without deploying.

DNS: apex `openimages.cloud` (and `www` → apex) on the same Cloudflare zone as `images.openimages.cloud`.

## Architecture

```
src/
  data/images.yaml         curated catalog: os, repo, latest/previous versions, variants,
                           status (stable | archive | preview), login user, featured
  lib/images.ts            build-time enrichment: fetches each MANIFEST.json and the file
                           size (HEAD) from images.openimages.cloud; cosign identity constants
  layouts/Base.astro       HTML shell, theme bootstrap, copy-to-clipboard handler
  pages/
    index.astro            landing: verify terminal, stats, catalog, how it works
    images/index.astro     catalog with client-side filter
    images/[os].astro      image page: downloads, quick start (OpenStack, Proxmox, verify),
                           provenance panel, previous releases
    verify.astro           step-by-step verification guide
  components/              Header, Footer, ImageRow, StatusBadge, CodeBlock, Terminal, ThemeToggle
  styles/global.css        Tailwind v4 theme, semantic light/dark tokens, self-hosted fonts
public/                    static assets (logos, favicons, og image)
```

The catalog is pure-static: the build reads `src/data/images.yaml`, fetches each image's
`MANIFEST.json` and file size from the published bucket, and renders the pages. A failed fetch
degrades gracefully (the image is listed without enriched metadata), so the site always builds.

Fonts (Inter, JetBrains Mono) are self-hosted through Fontsource: the site makes no third-party
requests.

**Signature identity.** Keyless signatures carry the identity of the reusable build workflow in
`open-img-cloud/.github`, not of the image repository. The `--certificate-identity-regexp`
shown on the site comes from `CERT_IDENTITY_REGEXP` in `src/lib/images.ts`; keep it in sync
with `IMAGE_STANDARDS.md`, section A.

## License

[Apache-2.0](LICENSE).
