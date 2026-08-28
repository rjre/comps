# Comps

An automation assistant that finds and enters public giveaways/sweepstakes on
your behalf, designed to run unattended (e.g. on a Raspberry Pi).

## How it's scoped

Giveaway sites almost always limit entries to one per person and prohibit
bot/bulk entry in their terms. To keep this a genuine time-saver rather than
something that gets an account banned or crosses into sweepstakes fraud, it's
built with a few hard rules:

- **One identity.** A single `Profile` is used for every entry — there's no
  concept of multiple identities entering the same competition.
- **Per-site adapters where we have them, a heuristic fallback otherwise.**
  Hand-written adapters (`src/lib/automation/adapters/*.ts`) map the profile
  onto a specific site's form fields, and are what the sites we actually
  target day-to-day use. Feed-discovered competitions with no adapter of
  their own use the `generic` adapter, which pattern-matches common field
  names and fills what it can confidently match. An unrecognised
  `adapterKey` is never silently upgraded to `generic` — the runner skips
  it and says so.
- **No CAPTCHA-solving or anti-bot evasion.** If a site presents a CAPTCHA or
  blocks automated entry, the adapter fails loudly rather than working
  around it.
- **Respects each competition's own entry cap and cadence.**
  `Competition.maxEntries` records how many entries that competition allows
  per person; `entryIntervalHours` records how often. A daily prize draw is
  entered once a day, not once per pass.
- **No auto-consent.** Adapters must not tick marketing/data-sharing consent
  boxes on your behalf — the generic adapter actively unchecks ones it
  recognizes as opt-in marketing if a site defaults them to checked.
- **Never guesses a quiz answer.** Where a competition poses a question, the
  answer is either hand-researched or derived from the competition page's
  own descriptive copy — and only when exactly one of the offered options
  actually appears in that copy. Anything ambiguous is declined and logged.
- **Polite by default.** A shared per-host rate limit and a best-effort
  robots.txt check (`src/lib/net/politeness.ts`) apply to discovery fetches
  and entry submissions alike.

## The two halves

**Entering** is driven by `src/lib/scheduler/runOnce.ts`. It decides what's
due, then drives the relevant adapter with Playwright.

**Finding** happens two ways, deliberately kept separate:

1. **Feed/scraper discovery** (`src/lib/discovery/runDiscovery.ts`) polls
   RSS/Atom feeds and static-HTML listing pages from comping aggregators,
   managed at `/sources`. Feed items usually link to a page *about* a
   competition rather than the sponsor's real form, so
   `resolveEntryUrl.ts` follows the redirect/outbound-link chain to resolve
   the actual off-site form. Resolution is HTTP-redirect based only (no JS
   execution); if a site needs a JS click to leave its own domain, that
   item is skipped rather than guessed at. These become `generic`-adapter
   competitions.
2. **Platform discovery** (`src/lib/discovery/dmri.ts`) reads a known
   platform's own competition index and registers what's open, for
   platforms we already have a real adapter for. Narrower than feed
   discovery and much higher yield: the DMRI reader-comps platform (Marie
   Claire, Woman, Woman's Weekly, What's On TV) runs dozens of concurrent
   daily draws that one adapter already handles.

`npm run db:seed` seeds 13 RSS feeds and 2 HTML-scraped listing sources
verified live as of Aug 2026 — see `prisma/seed.ts` for the full list and
for everything checked and deliberately excluded, with reasons.

## What "due" means

`src/lib/scheduler/schedule.ts` decides, purely from a competition's own
entry history, before a browser is opened:

- **Repeatable draws** (`maxEntries > 1`) are re-entered once their
  `entryIntervalHours` is up — 24h by default. Without this, a 10-minute
  entry loop would resubmit a daily draw's form until the site refused it.
- **Failures back off** — 1h, 2h, 4h, 8h, 16h, then daily — so one broken
  site can't consume every pass. After 12 *consecutive* failures with no
  success in between, the competition is marked `FAILED` with a note
  rather than retried forever.
- **Declines** (`SKIPPED_RULES`, e.g. a quiz whose answer can't be
  established) are rechecked daily, not every pass.
- **Closed** competitions and ones at their entry cap are retired to
  `CLOSED` / `ENTERED` so they stop being re-queried.

Due competitions are attempted least-recently-attempted first, so a pass
that runs out of its time budget always makes progress on whatever the last
one didn't reach. Each pass takes a file lock (`data/locks/`), so a
hand-started run and a worker-driven one can never enter the same
competition at once.

## Checking for wins (Gmail)

`/wins` lists emails that look like a prize notification, found by scanning
Gmail with a "you've won"-shaped search. This uses the `gmail.readonly`
OAuth scope only — the app is *structurally* unable to send, delete, modify
or mark mail read with that scope. Nothing is acted on automatically; it's a
list for you to check.

Setup (one-time, needs a human in the loop):

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project, enable the **Gmail API**, and create an OAuth **Desktop app**
   client ID/secret. Add yourself as a test user if the consent screen is
   in testing mode.
2. Put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`.
3. Run `npm run gmail:auth` — it prints a URL, you authorize in a browser,
   and it prints back a `GOOGLE_REFRESH_TOKEN` to add to `.env`. If that's
   the Pi over SSH, forward the port first: `ssh -L 53682:localhost:53682 <pi>`.
4. Restart the worker.

## Stack

- Next.js (App Router) + TypeScript — dashboard for profile, sources,
  competitions, run history & possible wins
- Prisma + SQLite — profile, feed sources, tracked competitions, entry log,
  newsletters, run logs, potential wins
- Playwright — drives the per-site and generic adapters
- `src/worker/index.ts` — a single long-running process with independent
  loops (feed discovery, platform discovery, entries, newsletter signups,
  housekeeping, and mail scanning if configured). This is the whole
  unattended app: no external cron, no dependency on Claude or any other
  service once it's running.

## Getting started (development)

```bash
cp .env.example .env
npm install
npm run db:push     # creates prisma/dev.db from the schema
npm run db:seed     # optional: seed the verified feed sources
npm run dev         # dashboard at http://localhost:3000
```

Then go to `/profile` to set up the identity to use for entries, and
`/sources` to add RSS feeds (or `/competitions` to add one manually).

Run individual passes by hand while testing:

```bash
npm run run:discovery        # one feed/scraper discovery pass
npm run discover:competitions # one platform (DMRI) discovery pass
npm run run:entries          # one entry pass
npm run subscribe:newsletters # one newsletter-signup pass
npm run prune                # age out old screenshots and log lines
npm run worker               # all of them, continuously, on .env intervals
npm test                     # regression tests — no network needed
```

`DRY_RUN=1` makes the entry and newsletter passes fill forms without
submitting.

## Deploying to a Raspberry Pi

1. Clone this repo to `/home/<user>/comps` on the Pi (Raspberry Pi OS,
   Node.js 20+ installed).
2. `bash deploy/install-pi.sh` — installs dependencies, Playwright's
   Chromium + OS deps, sets up the SQLite DB, builds the dashboard, and
   installs+starts two systemd services:
   - `comps-worker@<user>.service` — the worker (this is what actually does
     the automation)
   - `comps-web@<user>.service` — the dashboard, on port 3000
3. Edit `.env` (intervals, concurrency, rate limits) and
   `sudo systemctl restart comps-worker@<user>` to apply changes.
4. `journalctl -u comps-worker@<user> -f` to watch it run.

Both services restart automatically on failure and start on boot.

## Housekeeping

Both things that grew without bound are now capped by `npm run prune`,
which the worker runs on its own loop: full-page screenshots (JPEG, and
only for outcomes an adapter couldn't explain) and `LogLine` rows.
`Entry` and `Run` rows are never pruned — the scheduler decides what's due
purely from entry history, so deleting entries would make a daily draw look
never-entered and re-enter it immediately.
