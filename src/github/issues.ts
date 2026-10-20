import type { GitHubClient } from './client.js';

export interface RawComment {
  id: string;
  url: string;
  body: string;
  createdAt: string;
  author: string;
  association: string;
  minimized: boolean;
  /** 👍 ❤️ 🎉 🚀 */
  positiveReactions: number;
}

export interface RawIssue {
  repo: string;
  number: number;
  title: string;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  association: string;
  labels: string[];
  positiveReactions: number;
  commentCount: number;
  /** First 30 and last 15 comments, deduplicated, oldest first. */
  comments: RawComment[];
}

export interface CanonicalRepo {
  fullName: string;
  archived: boolean;
  hasIssues: boolean;
}

/** Resolve renames/transfers: `repo:old/name` search returns 422, `GET /repos` follows the redirect. */
export async function canonicalRepo(client: GitHubClient, owner: string, name: string): Promise<CanonicalRepo | undefined> {
  const r = await client.rest<{ full_name: string; archived: boolean; has_issues: boolean }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  );
  if (!r) return undefined;
  return { fullName: r.full_name, archived: r.archived, hasIssues: r.has_issues };
}

const COMMENT_FIELDS = `id url body createdAt author { login } authorAssociation isMinimized reactionGroups { content reactors { totalCount } }`;

export const SEARCH_QUERY = `query($q: String!, $first: Int!, $after: String) {
  search(type: ISSUE, query: $q, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue {
        number title url body createdAt updatedAt
        author { login } authorAssociation
        labels(first: 10) { nodes { name } }
        reactionGroups { content reactors { totalCount } }
        comments { totalCount }
        firstComments: comments(first: 30) { nodes { ${COMMENT_FIELDS} } }
        lastComments: comments(last: 15) { nodes { ${COMMENT_FIELDS} } }
      }
    }
  }
}`;

interface GqlReactionGroup {
  content: string;
  reactors: { totalCount: number };
}
interface GqlComment {
  id: string;
  url: string;
  body: string;
  createdAt: string;
  author: { login: string } | null;
  authorAssociation: string;
  isMinimized: boolean;
  reactionGroups: GqlReactionGroup[] | null;
}
interface GqlIssue {
  number?: number;
  title: string;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string } | null;
  authorAssociation: string;
  labels: { nodes: Array<{ name: string }> };
  reactionGroups: GqlReactionGroup[] | null;
  comments: { totalCount: number };
  firstComments: { nodes: GqlComment[] };
  lastComments: { nodes: GqlComment[] };
}
interface GqlSearch {
  search: { issueCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlIssue[] };
}

const POSITIVE = new Set(['THUMBS_UP', 'HEART', 'HOORAY', 'ROCKET']);

function positive(groups: GqlReactionGroup[] | null): number {
  return (groups ?? []).filter((g) => POSITIVE.has(g.content)).reduce((sum, g) => sum + g.reactors.totalCount, 0);
}

function toComment(c: GqlComment): RawComment {
  return {
    id: c.id,
    url: c.url,
    body: c.body,
    createdAt: c.createdAt,
    author: c.author?.login ?? 'ghost',
    association: c.authorAssociation,
    minimized: c.isMinimized,
    positiveReactions: positive(c.reactionGroups),
  };
}

export function versionQuery(repo: string, version: string): string {
  return `repo:${repo} is:issue is:open ("${version}" OR "v${version}") sort:reactions-desc`;
}

export interface VersionSearch {
  /** issueCount GitHub reported (unstable; see RESEARCH §2). */
  searchHits: number;
  issues: RawIssue[];
}

/** Open issues in `repo` whose text GitHub thinks mentions `version`. Callers must verify. */
export async function searchVersionIssues(client: GitHubClient, repo: string, version: string, max: number): Promise<VersionSearch> {
  const issues: RawIssue[] = [];
  let after: string | null = null;
  let searchHits = 0;
  while (issues.length < max) {
    const first = Math.min(25, max - issues.length);
    const data: GqlSearch = await client.graphql<GqlSearch>(SEARCH_QUERY, { q: versionQuery(repo, version), first, after });
    searchHits = data.search.issueCount;
    for (const n of data.search.nodes) {
      if (typeof n.number !== 'number') continue; // pull requests or empty fragments
      const seen = new Set<string>();
      const comments: RawComment[] = [];
      for (const c of [...n.firstComments.nodes, ...n.lastComments.nodes]) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        comments.push(toComment(c));
      }
      comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      issues.push({
        repo,
        number: n.number,
        title: n.title,
        url: n.url,
        body: n.body,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        author: n.author?.login ?? 'ghost',
        association: n.authorAssociation,
        labels: n.labels.nodes.map((l) => l.name),
        positiveReactions: positive(n.reactionGroups),
        commentCount: n.comments.totalCount,
        comments,
      });
    }
    if (!data.search.pageInfo.hasNextPage || !data.search.pageInfo.endCursor) break;
    after = data.search.pageInfo.endCursor;
  }
  return { searchHits, issues };
}
