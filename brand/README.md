# Brand assets

| File                | Use                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `logo.svg`          | The mark: rounded hexagon, stacked image layers, check on the top layer (signed, verifiable). Same drawing as `src/components/Logo.astro`. |
| `favicon.svg`       | Simplified mark for 16–32 px (two thicker layers, no check). Copied to `public/favicon.svg`.                                               |
| `og.svg`            | Social preview card, 1200×630, exported to `public/img/og.png`.                                                                            |
| `github-banner.svg` | Banner of the GitHub organisation profile, 1920×800 (`.github/profile/img/`).                                                              |
| `avatar-512.png`    | GitHub organisation avatar.                                                                                                                |

Colours: gradient `#4f8ef0` → `#2459c4` (brand blue, hue 252), navy `#0b1424`.
Type: Inter (semibold for the name), JetBrains Mono for labels.

Regenerate the PNGs with `node scripts/export-brand.mjs` (see the font note in the script).
