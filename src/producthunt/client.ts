import {
  PRODUCTHUNT_GRAPHQL_URL,
  type ResolvedProductHuntConfig,
} from './config.js';

export type ProductHuntPost = {
  id: string;
  name: string;
  tagline: string;
  slug: string;
  url: string;
  website?: string;
  votesCount: number;
  commentsCount: number;
  createdAt?: string;
  description?: string;
};

export type ProductHuntComment = {
  id: string;
  body: string;
  votesCount: number;
  createdAt?: string;
  userName?: string;
  userUsername?: string;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function edgesNodes(connection: unknown): JsonRecord[] {
  const edges = asRecord(connection).edges;
  if (!Array.isArray(edges)) return [];
  return edges.map((edge) => asRecord(asRecord(edge).node));
}

export function summarizePost(node: JsonRecord): ProductHuntPost {
  return {
    id: String(node.id ?? ''),
    name: String(node.name ?? ''),
    tagline: String(node.tagline ?? ''),
    slug: String(node.slug ?? ''),
    url: String(node.url ?? ''),
    website: typeof node.website === 'string' ? node.website : undefined,
    votesCount: Number(node.votesCount ?? 0),
    commentsCount: Number(node.commentsCount ?? 0),
    createdAt: typeof node.createdAt === 'string' ? node.createdAt : undefined,
    description: typeof node.description === 'string' ? node.description : undefined,
  };
}

const POST_FIELDS = `
  id
  name
  tagline
  slug
  url
  website
  votesCount
  commentsCount
  createdAt
  description
`;

/**
 * Thin Product Hunt GraphQL client (API v2).
 */
export class ProductHuntClient {
  constructor(private readonly config: ResolvedProductHuntConfig) {}

  private get token(): string {
    return this.config.token;
  }

  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    if (!this.token) {
      throw new Error('Product Hunt access token is missing.');
    }
    const res = await fetch(PRODUCTHUNT_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      const detail =
        typeof parsed === 'string'
          ? parsed
          : JSON.stringify(parsed ?? res.statusText).slice(0, 500);
      throw new Error(`Product Hunt GraphQL failed (HTTP ${res.status}): ${detail}`);
    }

    const body = asRecord(parsed);
    const errors = Array.isArray(body.errors) ? body.errors : [];
    if (errors.length > 0) {
      const messages = errors
        .map((e) => (typeof asRecord(e).message === 'string' ? asRecord(e).message : String(e)))
        .join('; ');
      throw new Error(`Product Hunt GraphQL errors: ${messages}`);
    }

    return body.data as T;
  }

  async verify(): Promise<{ ok: true; samplePost?: string }> {
    const data = await this.graphql<{
      posts?: { edges?: Array<{ node?: { name?: string } }> };
    }>(`query Verify { posts(first: 1) { edges { node { name } } } }`);
    const name = data.posts?.edges?.[0]?.node?.name;
    return { ok: true, samplePost: name };
  }

  async today(first = 20): Promise<ProductHuntPost[]> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const postedAfter = start.toISOString();
    const data = await this.graphql<{ posts?: unknown }>(
      `query Today($first: Int!, $postedAfter: DateTime!) {
        posts(first: $first, order: VOTES, postedAfter: $postedAfter) {
          edges { node { ${POST_FIELDS} } }
        }
      }`,
      { first: Math.min(Math.max(first, 1), 50), postedAfter },
    );
    return edgesNodes(data.posts).map(summarizePost);
  }

  async recent(first = 40): Promise<ProductHuntPost[]> {
    const data = await this.graphql<{ posts?: unknown }>(
      `query Recent($first: Int!) {
        posts(first: $first, order: NEWEST) {
          edges { node { ${POST_FIELDS} } }
        }
      }`,
      { first: Math.min(Math.max(first, 1), 50) },
    );
    return edgesNodes(data.posts).map(summarizePost);
  }

  async getPost(idOrSlug: string): Promise<ProductHuntPost> {
    const trimmed = idOrSlug.trim();
    const looksLikeId = /^\d+$/.test(trimmed);
    const data = looksLikeId
      ? await this.graphql<{ post?: JsonRecord }>(
          `query GetById($id: ID!) {
            post(id: $id) { ${POST_FIELDS} }
          }`,
          { id: trimmed },
        )
      : await this.graphql<{ post?: JsonRecord }>(
          `query GetBySlug($slug: String!) {
            post(slug: $slug) { ${POST_FIELDS} }
          }`,
          { slug: trimmed },
        );
    if (!data.post) {
      throw new Error(`Product Hunt post not found: ${trimmed}`);
    }
    return summarizePost(asRecord(data.post));
  }

  async comments(idOrSlug: string, first = 20): Promise<{ post: ProductHuntPost; comments: ProductHuntComment[] }> {
    const trimmed = idOrSlug.trim();
    const looksLikeId = /^\d+$/.test(trimmed);
    const commentFields = `
      id
      body
      votesCount
      createdAt
      user { name username }
    `;
    const data = looksLikeId
      ? await this.graphql<{ post?: JsonRecord }>(
          `query CommentsById($id: ID!, $first: Int!) {
            post(id: $id) {
              ${POST_FIELDS}
              comments(first: $first) {
                edges { node { ${commentFields} } }
              }
            }
          }`,
          { id: trimmed, first: Math.min(Math.max(first, 1), 50) },
        )
      : await this.graphql<{ post?: JsonRecord }>(
          `query CommentsBySlug($slug: String!, $first: Int!) {
            post(slug: $slug) {
              ${POST_FIELDS}
              comments(first: $first) {
                edges { node { ${commentFields} } }
              }
            }
          }`,
          { slug: trimmed, first: Math.min(Math.max(first, 1), 50) },
        );

    if (!data.post) {
      throw new Error(`Product Hunt post not found: ${trimmed}`);
    }
    const post = summarizePost(asRecord(data.post));
    const comments = edgesNodes(asRecord(data.post).comments).map((node) => {
      const user = asRecord(node.user);
      return {
        id: String(node.id ?? ''),
        body: String(node.body ?? ''),
        votesCount: Number(node.votesCount ?? 0),
        createdAt: typeof node.createdAt === 'string' ? node.createdAt : undefined,
        userName: typeof user.name === 'string' ? user.name : undefined,
        userUsername: typeof user.username === 'string' ? user.username : undefined,
      };
    });
    return { post, comments };
  }
}
