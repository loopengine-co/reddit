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

export const redditComment: ToolDefinition = {
  name: 'reddit_comment',
  description:
    'Reply on Reddit as the connected account: to a post, or to a comment in its thread. It is public at once, under the account\'s name. Write in Markdown, as a person in the conversation; follow the subreddit\'s rules (reddit_get_subreddit). parent is a post id or link, or a comment\'s id ("t1_...") or link. Returns the new comment\'s id and link.',
  input_schema: {
    type: 'object',
    properties: {
      parent: { type: 'string', description: 'The post to reply to (id or link), or the comment (its "t1_" id or link).' },
      text: { type: 'string', description: 'The exact reply, in Markdown.' },
    },
    required: ['parent', 'text'],
  },
  execute: async (input, ctx) => {
    const action = 'reddit_comment'
    const text = String(input.text ?? '').trim()
    if (!text) throw new Error(`${action}: text is required`)
    if (text.length > 10_000) throw new Error(`${action}: text is ${text.length} characters; Reddit allows 10,000`)
    const parent = thingRef(action, input.parent)
    const body = await redditRequest<{ json?: { errors?: unknown[][]; data?: { things?: { data: { id: string; permalink?: string } }[] } } }>(
      ctx.env, action, '/api/comment', { form: { thing_id: parent.fullname, text }, asUser: true },
    )
    redditWriteErrors(action, body)
    const comment = body.json?.data?.things?.[0]?.data
    if (!comment) throw new Error(`${action}: Reddit did not say whether the comment was posted; check the thread before trying again`)
    return JSON.stringify({
      comment_id: comment.id,
      replied_to: parent.fullname,
      ...(comment.permalink ? { link: `https://www.reddit.com${comment.permalink}` } : {}),
    })
  },
}
