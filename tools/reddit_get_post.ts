import type { AgentEnv, ToolDefinition } from 'loopengine'

// ---- Shared request helpers ----------------------------------------
// Duplicated verbatim across every tool file in this ability: add-ability
// copies each tool file standalone, with no shared-module support, so
// this block is the contract between them. Keep the copies identical.
//
// Uses Reddit's OAuth API. With only an app's client id and secret it
// reads public Reddit (application-only sign-in); posting and commenting
// also need the account to post as: a refresh token, or the account's
// username and password for a "script" app. Settings come from ctx.env,
// not process.env: loopengine resolves them per agent (see
// loopengine.ability.json's `scope`).
const REDDIT_API = 'https://oauth.reddit.com'
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'
const README = "see @loopengine-co/reddit's README"

// Access tokens last an hour; one per set of credentials, per tool file.
const accessTokens = new Map<string, { value: string; expiresAt: number }>()

type RedditError = Error & { status?: number }

function redditUserAgent(env: AgentEnv): string {
  const custom = env.get('REDDIT_USER_AGENT')
  if (custom) return custom
  const username = env.get('REDDIT_USERNAME')
  return `loopengine:loopengine-reddit:1.0.0${username ? ` (by /u/${username})` : ''}`
}

async function redditAccessToken(env: AgentEnv, action: string, asUser: boolean): Promise<{ token: string; key: string }> {
  const clientId = env.get('REDDIT_CLIENT_ID')
  if (!clientId) throw new Error(`${action}: REDDIT_CLIENT_ID is not set (${README})`)
  const secret = env.get('REDDIT_CLIENT_SECRET') ?? ''
  const refreshToken = env.get('REDDIT_REFRESH_TOKEN')
  const username = env.get('REDDIT_USERNAME')
  const password = env.get('REDDIT_PASSWORD')
  const grant: Record<string, string> = refreshToken
    ? { grant_type: 'refresh_token', refresh_token: refreshToken }
    : username && password
      ? { grant_type: 'password', username, password }
      : { grant_type: 'client_credentials' }
  if (asUser && grant.grant_type === 'client_credentials') {
    throw new Error(`${action}: posting needs the Reddit account to post as. Set REDDIT_REFRESH_TOKEN, or REDDIT_USERNAME and REDDIT_PASSWORD (${README}).`)
  }
  const key = [clientId, grant.grant_type, refreshToken ?? username ?? ''].join('|')
  const cached = accessTokens.get(key)
  if (cached && cached.expiresAt > Date.now() + 60_000) return { token: cached.value, key }

  const res = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': redditUserAgent(env),
    },
    body: new URLSearchParams(grant).toString(),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string | number }
  if (!res.ok || !body.access_token) {
    const hint =
      res.status === 401
        ? ' REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET is wrong.'
        : body.error === 'invalid_grant'
          ? grant.grant_type === 'refresh_token'
            ? ' REDDIT_REFRESH_TOKEN was revoked or is for another app; make a new one.'
            : ' REDDIT_USERNAME or REDDIT_PASSWORD is wrong, or the account uses two-factor sign-in (use a refresh token instead).'
          : body.error === 'unsupported_grant_type' && grant.grant_type === 'password'
            ? ' Username and password only work with a "script" app; use a refresh token for other app types.'
            : ''
    throw new Error(`${action}: Reddit sign-in failed (${res.status}${typeof body.error === 'string' ? ` ${body.error}` : ''}).${hint}`)
  }
  accessTokens.set(key, { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 })
  return { token: body.access_token, key }
}

async function redditRequest<T>(env: AgentEnv, action: string, path: string, init: { form?: Record<string, string>; asUser?: boolean } = {}): Promise<T> {
  const { token, key } = await redditAccessToken(env, action, init.asUser ?? false)
  const url = `${REDDIT_API}${path}${path.includes('?') ? '&' : '?'}raw_json=1`
  const res = await fetch(url, {
    method: init.form ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'user-agent': redditUserAgent(env),
      ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(init.form ? { body: new URLSearchParams({ ...init.form, api_type: 'json' }).toString() } : {}),
  })
  if (res.status === 401) accessTokens.delete(key)
  const body = (await res.json().catch(() => ({}))) as T & { message?: string; reason?: string }
  if (!res.ok) {
    const reset = res.headers.get('x-ratelimit-reset')
    const hint =
      res.status === 401
        ? ' The sign-in expired; try again.'
        : res.status === 403
          ? ' The subreddit is private, quarantined or banned, or this account is not allowed to do this there.'
          : res.status === 404
            ? ' Not found: check the subreddit name or post link.'
            : res.status === 429
              ? ` Reddit is rate limiting${reset ? `; try again in ${Math.ceil(Number(reset))} seconds` : ''}.`
              : ''
    const detail = body.reason ?? body.message
    const error: RedditError = new Error(`${action}: Reddit error ${res.status}${detail ? `: ${detail}` : ''}.${hint}`)
    error.status = res.status
    throw error
  }
  return body
}

// Errors from a write (comment, submit) come back as 200 with
// json.errors: [[code, message, field], ...].
function redditWriteErrors(action: string, body: { json?: { errors?: unknown[][] } }): void {
  const errors = body.json?.errors ?? []
  if (!errors.length) return
  const text = errors.map((e) => `${String(e[1] ?? e[0])}${e[0] === 'RATELIMIT' ? '' : ` (${String(e[0])})`}`).join('; ')
  throw new Error(`${action}: Reddit refused it: ${text}`)
}

// "r/AI_Agents", "/r/AI_Agents/" or "AI_Agents" -> "AI_Agents".
function subredditName(action: string, value: unknown): string {
  const name = String(value ?? '').trim().replace(/^\/?r\//i, '').replace(/\/+$/, '')
  if (!/^[A-Za-z0-9_]{2,21}$/.test(name)) throw new Error(`${action}: "${String(value ?? '')}" is not a subreddit name`)
  return name
}

interface ThingRef {
  kind: 't3' | 't1'
  id: string
  fullname: string
  /** For a comment named by its link, the post it is on. */
  postId?: string
}

// A post or comment: its id ("1abc2de"), its fullname ("t3_1abc2de",
// "t1_kxyz123"), or its link (a comment's link names the comment).
function thingRef(action: string, value: unknown): ThingRef {
  const raw = String(value ?? '').trim()
  const full = raw.match(/^(t[13])_([a-z0-9]+)$/i)
  if (full) return { kind: full[1].toLowerCase() as 't3' | 't1', id: full[2].toLowerCase(), fullname: raw.toLowerCase() }
  if (/^[a-z0-9]{4,10}$/i.test(raw)) return { kind: 't3', id: raw.toLowerCase(), fullname: `t3_${raw.toLowerCase()}` }
  let url: URL | undefined
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
  } catch {
    // Not a link either.
  }
  if (url && /(^|\.)redd\.it$/i.test(url.hostname)) {
    const id = url.pathname.replace(/\//g, '').toLowerCase()
    if (/^[a-z0-9]+$/.test(id)) return { kind: 't3', id, fullname: `t3_${id}` }
  }
  if (url && /(^|\.)reddit\.com$/i.test(url.hostname)) {
    if (/\/s\/[A-Za-z0-9]+/.test(url.pathname)) throw new Error(`${action}: that is a Reddit share link; open it and use the post's full link instead`)
    const m = url.pathname.match(/\/comments\/([a-z0-9]+)(?:\/[^/]*\/([a-z0-9]+))?/i)
    if (m?.[2]) return { kind: 't1', id: m[2].toLowerCase(), fullname: `t1_${m[2].toLowerCase()}`, postId: m[1].toLowerCase() }
    if (m?.[1]) return { kind: 't3', id: m[1].toLowerCase(), fullname: `t3_${m[1].toLowerCase()}` }
  }
  throw new Error(`${action}: "${raw}" is not a Reddit post or comment id or link`)
}

function excerpt(text: unknown, max: number): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function isoTime(seconds: unknown): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null
}

interface Listing<T> { kind: 'Listing'; data: { after: string | null; children: { kind: string; data: T }[] } }

interface PostData {
  id: string
  name: string
  title: string
  subreddit: string
  author: string
  permalink: string
  url?: string
  is_self?: boolean
  selftext?: string
  score?: number
  upvote_ratio?: number
  num_comments?: number
  created_utc?: number
  link_flair_text?: string | null
  over_18?: boolean
  locked?: boolean
  archived?: boolean
  stickied?: boolean
}

// A post as the tools return it; `text_max` cuts its body (0 drops it).
function describePost(p: PostData, textMax: number) {
  return {
    post_id: p.id,
    title: p.title,
    subreddit: p.subreddit,
    author: p.author,
    link: `https://www.reddit.com${p.permalink}`,
    ...(p.is_self === false && p.url ? { links_to: p.url } : {}),
    ...(textMax > 0 && p.selftext ? { text: textMax === Infinity ? p.selftext : excerpt(p.selftext, textMax) } : {}),
    score: p.score ?? 0,
    comments: p.num_comments ?? 0,
    created_at: isoTime(p.created_utc),
    flair: p.link_flair_text ?? null,
    // Locked or archived posts take no new comments.
    can_comment: !p.locked && !p.archived,
    ...(p.over_18 ? { nsfw: true } : {}),
    ...(p.stickied ? { pinned: true } : {}),
  }
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  return Math.max(1, Math.min(max, Math.floor(Number(value) || fallback)))
}
// ---- End of shared helpers -----------------------------------------

interface CommentData {
  id: string
  name: string
  author: string
  body?: string
  score?: number
  created_utc?: number
  permalink?: string
  depth?: number
  is_submitter?: boolean
  replies?: Listing<CommentData> | ''
}

const COMMENT_SORTS = ['top', 'new', 'best', 'controversial', 'old']

export const redditGetPost: ToolDefinition = {
  name: 'reddit_get_post',
  description:
    'Read one Reddit post in full with its comments: title, full text, author, score, flair, whether it still takes comments, and the top comments (author, text, score, how deep in the thread, and whether the author is the poster). post is a post id or link; a comment\'s link shows that comment with the thread around it. Read the post before replying, to see what was already said.',
  input_schema: {
    type: 'object',
    properties: {
      post: { type: 'string', description: 'The post id (e.g. "1abc2de") or its link; or a comment\'s link.' },
      max_comments: { type: 'number', description: 'How many comments to return, 1 to 100. Default 25.' },
      comment_sort: { type: 'string', enum: COMMENT_SORTS, description: 'Order of comments. Default "top".' },
    },
    required: ['post'],
  },
  execute: async (input, ctx) => {
    const action = 'reddit_get_post'
    const ref = thingRef(action, input.post)
    if (ref.kind === 't1' && !ref.postId) throw new Error(`${action}: give the post's id or link, or the comment's full link`)
    const postId = ref.kind === 't3' ? ref.id : ref.postId!
    const max = clampLimit(input.max_comments, 25, 100)
    const sort = typeof input.comment_sort === 'string' && COMMENT_SORTS.includes(input.comment_sort) ? input.comment_sort : 'top'
    const params = new URLSearchParams({ limit: String(max), sort, depth: '4', ...(ref.kind === 't1' ? { comment: ref.id, context: '3' } : {}) })
    let data: [Listing<PostData>, Listing<CommentData>]
    try {
      data = await redditRequest<[Listing<PostData>, Listing<CommentData>]>(ctx.env, action, `/comments/${postId}?${params}`)
    } catch (err) {
      if ((err as { status?: number }).status === 404) throw new Error(`${action}: no post ${postId} on Reddit (it may have been removed)`)
      throw err
    }
    const post = data[0]?.data.children[0]?.data
    if (!post) throw new Error(`${action}: no post ${postId} on Reddit`)

    const comments: Record<string, unknown>[] = []
    const walk = (listing: Listing<CommentData> | '' | undefined): void => {
      if (!listing || typeof listing !== 'object') return
      for (const child of listing.data.children) {
        if (comments.length >= max) return
        if (child.kind !== 't1') continue
        const c = child.data
        comments.push({
          comment_id: c.id,
          author: c.author,
          text: excerpt(c.body, 1500),
          score: c.score ?? 0,
          depth: c.depth ?? 0,
          ...(c.is_submitter ? { is_poster: true } : {}),
          created_at: isoTime(c.created_utc),
          ...(c.permalink ? { link: `https://www.reddit.com${c.permalink}` } : {}),
        })
        walk(c.replies)
      }
    }
    walk(data[1])
    return JSON.stringify({ post: describePost(post, Infinity), comments, ...(ref.kind === 't1' ? { focused_comment_id: ref.id } : {}) })
  },
  safe: true,
}
