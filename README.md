# @loopengine-co/reddit

A [loopengine](https://github.com/loopengine-co/loopengine) ability:
Reddit tools to search posts, go through a subreddit, read a post with
its comments and a subreddit's rules, and comment and post, plus a skill
on finding conversations worth joining and replying without spamming.
Commenting and posting ask a person first by default.

```sh
npx loopengine add-ability @loopengine-co/reddit --agent <your-agent>
```

## What's in it

- **Tools**
  - `reddit_search(query, subreddit?, sort?, time?, posted_in_last_hours?,
    max_results?)`: posts matching keywords, across Reddit or in one
    subreddit.
  - `reddit_list_posts(subreddit, sort?, time?, posted_in_last_hours?,
    max_results?)`: a subreddit's new, hot, top or rising posts, without
    pinned ones.
  - `reddit_get_post(post, max_comments?, comment_sort?)`: one post in
    full with its top comments. A comment's link shows that comment with
    the thread around it.
  - `reddit_get_subreddit(subreddit)`: its description, members, who can
    post, and every rule with its explanation.
  - `reddit_comment(parent, text)`: replies to a post or a comment.
  - `reddit_create_post(subreddit, title, text? | url?, flair_id?)`: a
    text or link post.

  Posts come back with their id, title, subreddit, author, link, the
  start of their text, score, comment count, when they were posted, and
  `can_comment` (false for locked or archived posts). `post` and
  `parent` take an id or a link.
- **Skill**: `reddit-replies`: finding conversations, reading the thread
  and the rules first, and writing replies that help first and mention a
  product only where it fits, with disclosure.
- **actauth rules**: searching and reading are `allow`; commenting and
  posting are `ask`.

## Setup

### Reading only

Searching and reading need only a Reddit app:

1. Signed in to Reddit, open
   [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) and choose
   **create another app**.
2. Pick **script**, give it a name, and set the redirect URI to
   `http://localhost:8080` (it isn't used for scripts).
3. Copy the string under the app's name (the client id) and the
   **secret**.
4. Set them as `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` in the
   agent's **Environment** tab in the console.

Reddit's API is free for non-commercial use within its rate limits;
commercial use needs Reddit's approval
([Data API terms](https://redditinc.com/policies/data-api-terms)).
Reddit may also ask you to request API access before a new app works.

### Commenting and posting

These also need the account to post as. Either:

- **Username and password** (script apps): set `REDDIT_USERNAME` and
  `REDDIT_PASSWORD` for the account that created the app, or one added
  as a developer of it. This doesn't work for accounts with two-factor
  sign-in.
- **A refresh token** (any app type): make one for the account with the
  scopes `identity read submit` and `duration=permanent`, through
  Reddit's [OAuth flow](https://github.com/reddit-archive/reddit/wiki/OAuth2),
  and set it as `REDDIT_REFRESH_TOKEN`. It's used before a username and
  password when both are set.

Optionally set `REDDIT_USER_AGENT` to identify your app the way Reddit
asks, e.g. `web:acme-growth:1.0 (by /u/yourname)`. The default names
this ability and, when set, `REDDIT_USERNAME`.

All of these are shared by default; give an agent its own to post as a
different account.

## Permissions

| Tool | Default | Why |
| --- | --- | --- |
| `reddit_search`, `reddit_list_posts`, `reddit_get_post`, `reddit_get_subreddit` | allow | Read only |
| `reddit_comment`, `reddit_create_post` | ask | Public, under the account's name, and a bad one can get the account banned |

Change these in the agent's Permissions tab.
