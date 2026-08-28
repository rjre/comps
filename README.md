# Comps

An automation assistant that enters public giveaways/sweepstakes on your behalf.

## How it's scoped

Giveaway sites almost always limit entries to one per person and prohibit
bot/bulk entry in their terms. To keep this a genuine time-saver rather than
something that gets an account banned or crosses into sweepstakes fraud, it's
built with a few hard rules:

- **One identity.** A single `Profile` is used for every entry — there's no
  concept of multiple identities entering the same competition.
- **Per-site adapters, not generic scraping.** Each competition site gets a
  small adapter (`src/lib/automation/adapters/*.ts`) that maps the profile
  onto that site's actual form fields. No CAPTCHA-solving or anti-bot
  evasion — if a site blocks automated entry, that adapter should fail
  loudly, not work around it. The same rule governs discovery
  (`src/lib/discovery/*.ts`): a discovery source reads one known
  platform's own competition index, and can only ever propose competitions
  for an adapter that already exists.
- **Respects each competition's own entry cadence.** A daily prize draw is
  entered once a day, not once per cycle — see `entryIntervalHours` and
  `src/lib/scheduler/schedule.ts`.
- **Never guesses a quiz answer.** Where a competition poses a question,
  the answer is either hand-researched or derived from the competition
  page's own descriptive copy — and only when exactly one of the offered
  options actually appears in that copy. Anything ambiguous is declined
  and logged, not guessed at.
- **Respects each competition's own entry cap.** `Competition.maxEntries`
  records how many entries that competition allows per person; the runner
  won't submit past it.
- **No auto-consent.** Adapters must not tick marketing/data-sharing consent
  boxes on your behalf.

## Stack

- Next.js (App Router) + TypeScript — dashboard for profile & entry history
- Prisma + SQLite — profile, tracked competitions, entry log
- Playwright — drives the per-site adapters
- A standalone runner (`npm run run:entries`) and discovery pass
  (`npm run discover:competitions`), invoked on an hourly systemd timer via
  `scripts/run-entries-cycle.sh` for unattended operation

## Getting started

```bash
cp .env.example .env
npm install
npm run db:push     # creates prisma/dev.db from the schema
npm run dev          # dashboard at http://localhost:3000
```

Then:

1. Go to `/profile` and fill in the identity to use for entries.
2. Go to `/competitions` and add competitions, each pointing at an adapter
   key from `src/lib/automation/adapters/`.
3. Write a real adapter per site you want to target (copy
   `adapters/example.ts` as a starting point) — this needs the actual form
   field names from that competition's entry page.
4. Run `npm run run:entries` by hand, or on a schedule, to process pending
   competitions.

## How a cycle works

`scripts/run-entries-cycle.sh` runs hourly under a systemd user timer and
is the whole loop — search, enter, search, enter:

1. `git pull` + `npm run db:push` — pick up anything pushed from elsewhere.
2. `sync:competitions` / `sync:newsletters` — register candidates a cloud
   research routine wrote into `prisma/pending-*.json`.
3. `discover:competitions` — this machine finds its own candidates by
   reading the competition indexes of platforms it already has an adapter
   for, and registers whatever is open and not yet tracked.
4. `run:entries` — enter everything that's *due*.
5. `subscribe:newsletters` — work through pending newsletter signups.
6. `prune` — age out old screenshots and log lines.

No stage can abort the ones after it, and each stage's own failure is
reported separately, because this is meant to keep running indefinitely
rather than stop at the first bad day. Cycle output goes to
`data/cycle.log` (this machine's user journal retains nothing).

### What "due" means

`src/lib/scheduler/schedule.ts` decides, purely from a competition's own
entry history, before a browser is opened:

- **Repeatable draws** (`maxEntries > 1`) are re-entered once their
  `entryIntervalHours` is up — 24h by default. Without this, an hourly
  timer would resubmit a daily draw's form 24 times a day to be told
  "already entered today" 23 of them.
- **Failures back off** — 1h, 2h, 4h, 8h, 16h, then daily — so one broken
  site can't consume every pass. After 12 *consecutive* failures with no
  success in between, the competition is marked `FAILED` with a note
  rather than retried forever.
- **Declines** (`SKIPPED_RULES`, e.g. a quiz whose answer can't be
  established) are rechecked daily, not every pass.
- **Closed** competitions and ones at their entry cap are retired to
  `CLOSED` / `ENTERED` so they stop being re-queried.

Competitions that are due are attempted least-recently-attempted first, so
a pass that runs out of its time budget always makes progress on whatever
the last one didn't reach.

Both `run:entries` and `discover:competitions` take a file lock
(`data/locks/`), so a hand-started run and a timer-started one can never
enter the same competition at once.

`npm test` runs the assertions covering the scheduling decisions and the
quiz-answer derivation.

## Status

Running unattended. Entry adapters exist for ~18 sites; the DMRI
reader-comps platform (Marie Claire, Woman, Woman's Weekly, What's On TV)
is the one with automatic discovery, because it runs dozens of concurrent
daily draws that a single adapter already handles.
