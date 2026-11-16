/**
 * Build state of the image repositories for /status/, read from the GitHub API once per build:
 * two calls per repository (last release run, last upstream watch run) and one search for the
 * open upstream bump pull requests. GITHUB_TOKEN raises the rate limit when set (the deploy
 * passes it); without it, or when GitHub fails, every value degrades to "unknown".
 */
import { GITHUB_ORG } from "~/lib/github";

const API = "https://api.github.com";
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 6;
/** Release runs looked at to find the last one on main or a tag (test runs use branches). */
const RELEASE_RUNS_PAGE = 20;

export type RunState = "success" | "failure" | "cancelled" | "running" | "none" | "unknown";

export interface RunInfo {
  state: RunState;
  url: string | null;
  /** Start of the run (ISO 8601). */
  at: string | null;
}

export interface RepoStatus {
  release: RunInfo;
  watch: RunInfo;
}

export interface PendingBump {
  title: string;
  url: string;
}

interface WorkflowRun {
  status: string;
  conclusion: string | null;
  html_url: string;
  head_branch: string | null;
  run_started_at?: string;
  created_at: string;
}

const UNKNOWN: RunInfo = { state: "unknown", url: null, at: null };
const NONE: RunInfo = { state: "none", url: null, at: null };

/** Set once GitHub refuses a call (rate limit): later calls are skipped, not retried. */
let rateLimited = false;

type ApiResult = { ok: true; data: unknown } | { ok: false; status: number | null };

async function api(path: string): Promise<ApiResult> {
  if (rateLimited) return { ok: false, status: null };
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "openimages-ci",
    "x-github-api-version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, { headers, signal: ctrl.signal });
    if (
      res.status === 429 ||
      (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")
    ) {
      rateLimited = true;
      console.warn(`[status] GitHub rate limit reached at ${path}; remaining states unknown`);
      return { ok: false, status: res.status };
    }
    if (!res.ok) {
      if (res.status !== 404) console.warn(`[status] ${path} → HTTP ${res.status}`);
      return { ok: false, status: res.status };
    }
    return { ok: true, data: await res.json() };
  } catch (err) {
    console.warn(`[status] ${path} failed:`, (err as Error).message);
    return { ok: false, status: null };
  } finally {
    clearTimeout(timer);
  }
}

function runInfo(run: WorkflowRun): RunInfo {
  const at = run.run_started_at ?? run.created_at;
  if (run.status !== "completed") return { state: "running", url: run.html_url, at };
  const state: RunState =
    run.conclusion === "success"
      ? "success"
      : run.conclusion === "cancelled" || run.conclusion === "skipped"
        ? "cancelled"
        : "failure";
  return { state, url: run.html_url, at };
}

async function lastRun(
  repo: string,
  workflow: string,
  perPage: number,
  pick: (run: WorkflowRun) => boolean = () => true,
): Promise<RunInfo> {
  const res = await api(
    `/repos/${repo}/actions/workflows/${workflow}/runs?per_page=${perPage}&exclude_pull_requests=true`,
  );
  if (!res.ok) return res.status === 404 ? NONE : UNKNOWN;
  const runs = (res.data as { workflow_runs?: WorkflowRun[] }).workflow_runs ?? [];
  const run = runs.find(pick);
  return run ? runInfo(run) : NONE;
}

/**
 * release.yml runs on a v<VERSION> tag (pushed, or dispatched by auto-release.yml) and is
 * dispatched on main to republish; runs on other branches are tests and are skipped.
 */
async function repoStatus(repo: string): Promise<RepoStatus> {
  const [release, watch] = await Promise.all([
    lastRun(
      repo,
      "release.yml",
      RELEASE_RUNS_PAGE,
      (r) => r.head_branch === "main" || /^v\d/.test(r.head_branch ?? ""),
    ),
    lastRun(repo, "watch.yml", 1),
  ]);
  return { release, watch };
}

/** Open pull requests of the upstream watchers (label upstream-bump), by repository. */
async function pendingBumps(): Promise<Map<string, PendingBump> | null> {
  const res = await api(
    `/search/issues?q=${encodeURIComponent(`org:${GITHUB_ORG} is:pr is:open label:upstream-bump`)}&per_page=100`,
  );
  if (!res.ok) return null;
  const items =
    (res.data as { items?: { title: string; html_url: string; repository_url: string }[] }).items ??
    [];
  const out = new Map<string, PendingBump>();
  for (const item of items) {
    const repo = item.repository_url.replace(`${API}/repos/`, "");
    if (!out.has(repo)) out.set(repo, { title: item.title, url: item.html_url });
  }
  return out;
}

export interface BuildStatus {
  /** By repository, e.g. "open-img-cloud/debian-13". */
  repos: Map<string, RepoStatus>;
  /** null when the search failed: upstream state unknown. */
  bumps: Map<string, PendingBump> | null;
  /** Calls made to the GitHub API (logged, to keep an eye on the quota). */
  calls: number;
}

async function fetchBuildStatus(repos: string[]): Promise<BuildStatus> {
  const unique = [...new Set(repos)];
  const out = new Map<string, RepoStatus>();
  const queue = [...unique];
  const bumps = pendingBumps();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let repo = queue.shift(); repo; repo = queue.shift()) {
        out.set(repo, await repoStatus(repo));
      }
    }),
  );
  const calls = unique.length * 2 + 1;
  console.log(`[status] ${unique.length} repositories, up to ${calls} GitHub API calls`);
  return { repos: out, bumps: await bumps, calls };
}

let cache: Promise<BuildStatus> | null = null;

export function loadBuildStatus(repos: string[]): Promise<BuildStatus> {
  cache ??= fetchBuildStatus(repos);
  return cache;
}

export { UNKNOWN as UNKNOWN_RUN };
