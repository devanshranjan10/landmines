import type { Http } from '../http.js';
import { USER_AGENT } from '../version.js';

export type GitHubErrorKind = 'auth' | 'rate-limit' | 'not-found' | 'http' | 'graphql' | 'network';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: GitHubErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface GitHubClientOptions {
  http: Http;
  token: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
  /** Longest single wait for a rate-limit reset before giving up. */
  maxWaitMs?: number;
  concurrency?: number;
  log?: (message: string) => void;
  apiBase?: string;
}

const API_VERSION = '2026-03-10';

/** Small semaphore so scans never hammer the API. */
class Limiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export class GitHubClient {
  private readonly http: Http;
  private readonly token: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxRetries: number;
  private readonly maxWaitMs: number;
  private readonly limiter: Limiter;
  private readonly log: (message: string) => void;
  private readonly apiBase: string;

  constructor(opts: GitHubClientOptions) {
    this.http = opts.http;
    this.token = opts.token;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.maxRetries = opts.maxRetries ?? 3;
    this.maxWaitMs = opts.maxWaitMs ?? 120_000;
    this.limiter = new Limiter(opts.concurrency ?? 2);
    this.log = opts.log ?? (() => {});
    this.apiBase = opts.apiBase ?? 'https://api.github.com';
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': API_VERSION,
    };
  }

  /** How long to wait before retrying a rate-limited response, or undefined if it is not a rate limit. */
  private rateLimitWait(res: Response, bodyText: string): number | undefined {
    if (res.status !== 403 && res.status !== 429) return undefined;
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining === '0' && reset && /^\d+$/.test(reset)) return Math.max(1000, Number(reset) * 1000 - this.now() + 1000);
    if (/rate limit/i.test(bodyText)) return 60_000;
    return undefined;
  }

  private async request(method: string, url: string, body?: string): Promise<{ status: number; text: string }> {
    return this.limiter.run(async () => {
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await this.http.fetch(url, {
            method,
            headers: { ...this.headers(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body } : {}),
          });
        } catch (err) {
          if (attempt < this.maxRetries) {
            await this.sleep(1000 * 2 ** attempt);
            continue;
          }
          throw new GitHubError(`Network error calling GitHub: ${(err as Error).message}`, 'network');
        }
        const text = await res.text();
        const wait = this.rateLimitWait(res, text);
        if (wait !== undefined) {
          if (attempt >= this.maxRetries || wait > this.maxWaitMs) {
            throw new GitHubError(`GitHub rate limit hit (${res.status}); retry in ~${Math.ceil(wait / 1000)}s`, 'rate-limit', res.status);
          }
          this.log(`GitHub rate limit; waiting ${Math.ceil(wait / 1000)}s`);
          await this.sleep(wait);
          continue;
        }
        if (res.status >= 500 && attempt < this.maxRetries) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        if (res.status === 401) throw new GitHubError('GitHub rejected the token (401). Check GITHUB_TOKEN or `gh auth status`.', 'auth', 401);
        return { status: res.status, text };
      }
    });
  }

  /** GET a REST path. 404 resolves to `undefined`. */
  async rest<T>(path: string): Promise<T | undefined> {
    const { status, text } = await this.request('GET', `${this.apiBase}${path}`);
    if (status === 404) return undefined;
    if (status >= 400) throw new GitHubError(`GitHub ${status} for ${path}: ${text.slice(0, 200)}`, 'http', status);
    return JSON.parse(text) as T;
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const { status, text } = await this.request('POST', `${this.apiBase}/graphql`, JSON.stringify({ query, variables }));
      if (status >= 400) throw new GitHubError(`GitHub GraphQL ${status}: ${text.slice(0, 200)}`, 'http', status);
      const parsed = JSON.parse(text) as { data?: T; errors?: Array<{ type?: string; message?: string }> };
      const rateLimited = parsed.errors?.some((e) => e.type === 'RATE_LIMITED' || /rate limit/i.test(e.message ?? ''));
      if (rateLimited && attempt < this.maxRetries) {
        this.log('GitHub GraphQL rate limit; waiting 60s');
        await this.sleep(60_000);
        continue;
      }
      if (parsed.errors?.length && !parsed.data) {
        throw new GitHubError(`GitHub GraphQL error: ${parsed.errors.map((e) => e.message).join('; ')}`, rateLimited ? 'rate-limit' : 'graphql');
      }
      if (!parsed.data) throw new GitHubError('GitHub GraphQL returned no data', 'graphql');
      return parsed.data;
    }
  }
}
