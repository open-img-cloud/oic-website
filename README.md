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

The site is deployed to [Cloudflare Pages](https://pages.cloudflare.com), connected to this repository. Production deploys on push to `main`; preview deploys on pull requests.

DNS: apex `openimages.cloud` (and `www` → apex) on the same Cloudflare zone as `images.openimages.cloud`.

## Architecture

```
src/
  data/images.yaml         curated list of images (os, repo, latest version, paths)
  layouts/                 base HTML layout
  pages/
    index.astro            landing page
    images/index.astro     catalog
    images/[os].astro      image detail (versions, checksums, cosign verify, usage)
  components/              reusable UI components
  lib/manifest.ts          build-time MANIFEST.json fetcher
public/                    static assets
```

The catalog is pure-static: the build script reads `src/data/images.yaml`, fetches each image's `MANIFEST.json` from the published bucket, and renders the pages. If a fetch fails, the build degrades gracefully (image listed without enriched metadata) so the site stays publishable.

## License

[Apache-2.0](LICENSE).
