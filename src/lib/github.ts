/**
 * GitHub stars of the whole organisation (every public repository), fetched once per build.
 * The deploy passes GITHUB_TOKEN for a higher rate limit; without it the anonymous API is
 * used. null (API down, rate limited) hides the count.
 */
export const GITHUB_ORG = "open-img-cloud";
const TIMEOUT_MS = 10_000;

async function fetchOrgStars(): Promise<number | null> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "openimages-ci",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://api.github.com/orgs/${GITHUB_ORG}/repos?type=public&per_page=100&page=${page}`,
        { headers, signal: ctrl.signal },
      );
      if (!res.ok) {
        console.warn(`[github] repos page ${page} → HTTP ${res.status}, star count hidden`);
        return null;
      }
      const repos = (await res.json()) as { stargazers_count?: number }[];
      total += repos.reduce((n, r) => n + (r.stargazers_count ?? 0), 0);
      if (repos.length < 100) return total;
    } catch (err) {
      console.warn("[github] star count unavailable:", (err as Error).message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return total;
}

let cache: Promise<number | null> | null = null;

export function loadOrgStars(): Promise<number | null> {
  cache ??= fetchOrgStars();
  return cache;
}

/** 1234 → "1.2k", like GitHub. */
export function formatStars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n);
}
