---
name: reddit-replies
description: How to use the @loopengine-co/reddit tools to find Reddit conversations worth joining, judge them, follow each subreddit's rules, and draft replies that help first and mention your product only where it fits, without spamming.
---

# Reddit replies

The @loopengine-co/reddit tools search and read Reddit, and comment and
post as the connected account. Reddit communities are quick to remove
and ban anything that reads like an ad, so the job is to be useful in the
conversation. Mentioning a product is the exception, not the goal.

## Find conversations

- `reddit_search` with a real query, not just a topic word:
  `"AI agent" OR automation -hiring`. Use `subreddit` to stay in one
  community and `posted_in_last_hours: 24` for a daily run.
- `reddit_list_posts` with `sort: "new"` to go through a subreddit's
  fresh posts; it leaves out pinned posts.

Good candidates ask a question or describe a problem: "how do I
automate…", "which tool should I use for…", "has anyone built…". Skip
posts that can't take comments (`can_comment: false`), memes, news
links with nothing to answer, and anything older than a few days unless
it's still active.

## Read before replying

1. `reddit_get_post` for the full text and the top comments. If someone
   already gave the answer you'd give, pass, or add only what's missing.
   Check whether the connected account already commented.
2. `reddit_get_subreddit` for the rules. Many subreddits ban
   self-promotion, links, or new accounts, or only allow promotion in a
   weekly thread. If a rule forbids it, don't mention the product there
   at all.

## Write the reply

- Answer the question itself first, with specifics: steps, trade-offs,
  what you'd try. A reply should still be useful if the product line
  were deleted.
- Mention the product only when it really solves what they asked, and
  say plainly that you work on it ("I work on LoopEngine, which…").
  Never pretend to be an unrelated happy user.
- Write like a person in the thread: short paragraphs, the subreddit's
  tone, no headings or marketing words. Usually under 150 words.
- One link at most, and only where the rules allow it.

## Posting asks first

`reddit_comment` and `reddit_create_post` ask a person by default. When
you call one, the person approving sees the exact text, so make it the
final version. In a scheduled run, the question goes to wherever the
agent sends approvals (its Messaging tab). If nothing is set up there,
the post is turned down, so a scheduled run that never posts usually
means messaging isn't set up.

When the job is only to draft (for example "send me the links and a
draft reply"), don't call `reddit_comment` at all. Report each post's
link, why it's worth answering, and the draft.

## Judgment over volume

Two good replies beat ten generic ones. Passing on most candidates is
normal. Report what you found plainly: the posts you looked at, which
ones you drafted for and why, and which you skipped and why. "Nothing
worth answering today" is a complete answer.

## Things never to do

- Never post the same text in more than one place.
- Never reply in a subreddit whose rules forbid what you're about to do.
- Never invent experience, numbers or customers.
- Never argue with a moderator's removal, or post again after one.
