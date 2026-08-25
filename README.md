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
  onto a specific site's form fields. Anything without one uses the
  `generic` adapter, which pattern-matches common field names/labels
  (email, first/last name, address, etc.) and fills whatever it can
  confidently match — this is what makes "as many sites as possible"
  practical, at the cost of being less reliable per-site than a hand-written
  adapter.
- **No CAPTCHA-solving or anti-bot evasion.** If a site presents a CAPTCHA or
  requires login, the adapter skips it rather than trying to defeat it.
- **Respects each competition's own entry cap.** `Competition.maxEntries`
  records how many entries that competition allows per person; the runner
  won't submit past it.
- **No auto-consent.** Adapters must not tick marketing/data-sharing consent
  boxes on your behalf — the generic adapter actively unchecks ones it
  recognizes as opt-in marketing if a site defaults them to checked.
- **Polite by default.** A shared per-host rate limit and a best-effort
  robots.txt check (`src/lib/net/politeness.ts`) apply to both discovery
  fetches and entry submissions.

## How discovery works

Competitions are found by polling RSS/Atom feeds (managed at `/sources`) from
sites that exist specifically to list new giveaways for people to enter (e.g.
comping-community aggregators). Each feed item usually links to a page
*about* the competition rather than the sponsor's real entry form, so
`src/lib/discovery/resolveEntryUrl.ts` follows the redirect/outbound link
chain to resolve the actual off-site form before adding it as a tracked
`Competition`. Resolution is HTTP-redirect based only (no JS execution) — if
a site needs a JS click to leave its own domain, that item is skipped rather
than guessed at.

Some sites have no RSS feed at all — for those, a scraper under
`src/lib/discovery/scrapers/*.ts` parses their static-HTML listing page
instead (pagination and all), producing the same shape of item that RSS
parsing does, so everything downstream (URL resolution, dedup, Competition
creation) is identical either way. `resolveEntryUrl` also understands a
second pattern beyond plain `<a href>` outbound links: some JS-framework
sites (e.g. Astro islands) server-render the real off-site URL into a
component's hydration props rather than a visible link — it sniffs those
too, still with no JS execution.

`npm run db:seed` (part of `deploy/install-pi.sh`) seeds 13 RSS feeds and 2
HTML-scraped listing sources I found and verified live as of Aug 2026 — see
`prisma/seed.ts` for the full list and for everything I checked and
deliberately excluded, with the specific reason (bot-challenge redirects,
mismatched TLS certs, no working feed, mirrored/duplicate content, dynamic
JS-loaded content not worth scraping yet, Reddit's anti-scraping ToS, or
real feeds that turned out to be mostly discount codes/free game keys
rather than fillable entry forms). Add more at `/sources` any time.

I didn't wire up a fully automatic "search the web for new feeds" pipeline,
since that needs a paid search-API key to run unattended on the Pi itself —
today, growing the source list means asking me to find and verify more
(which I can do anytime), or adding one yourself at `/sources`.

Throughput note: with the default 4s per-host politeness delay and most
items needing 2 fetches to resolve (the listing page, then its outbound
link's redirect target), a full discovery pass across all seeded sources
takes on the order of tens of minutes, not seconds — that's deliberate
(see "Polite by default" above), and is why discovery and entries run on
independent loops rather than one blocking the other.

## Checking for wins (Gmail)

`/wins` lists emails that look like a prize notification, found by scanning
Gmail with a "you've won"-shaped search. This uses the `gmail.readonly`
OAuth scope only — the app is *structurally* unable to send, delete,
modify, or mark mail read with that scope, regardless of what the code
does; it can only list and read. Nothing here is acted on automatically —
it's a list for you to check yourself, in case a win email gets missed
among however many confirmation emails hundreds of entries generate.

Setup (one-time, needs a human in the loop — this is not something to run
unattended):

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project, enable the **Gmail API**, and create an OAuth **Desktop app**
   client ID/secret. Add yourself as a test user if the consent screen is
   in testing mode.
2. Put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`.
3. Run `npm run gmail:auth` — it prints a URL, you authorize in a browser
   with the Gmail account to scan, and it prints back a
   `GOOGLE_REFRESH_TOKEN` to add to `.env`. Run this on a machine with a
   browser; if that's the Pi itself over SSH, forward the port first:
   `ssh -L 53682:localhost:53682 <pi>`.
4. Restart the worker. It'll start scanning on `MAIL_SCAN_INTERVAL_MINUTES`.

`MAIL_SCAN_QUERY` in `.env` controls the search — customize it if the
default catches too much/little noise.

## Stack

- Next.js (App Router) + TypeScript — dashboard for profile, sources, entry
  history & possible wins
- Prisma + SQLite — profile, feed sources, tracked competitions, entry log,
  potential wins
- Playwright — drives the per-site and generic adapters
- `src/worker/index.ts` — a single long-running process with independent
  loops (discovery, entries, and mail scanning if configured); this is the
  whole unattended app, no external cron and no dependency on Claude or any
  other service once it's running

## Getting started (development)

```bash
cp .env.example .env
npm install
npm run db:push     # creates prisma/dev.db from the schema
npm run dev          # dashboard at http://localhost:3000
```

Then go to `/profile` to set up the identity to use for entries, and
`/sources` to add RSS feeds (or `/competitions` to add one manually).

Run everything by hand while testing:

```bash
npm run run:discovery   # one discovery pass
npm run run:entries     # one entry pass
npm run worker          # both, continuously, on the intervals in .env
```

## Deploying to a Raspberry Pi

1. Clone this repo to `/home/<user>/comps` on the Pi (Raspberry Pi OS,
   Node.js 20+ installed).
2. `bash deploy/install-pi.sh` — installs dependencies, Playwright's
   Chromium + OS deps, sets up the SQLite DB, builds the dashboard, and
   installs+starts two systemd services:
   - `comps-worker@<user>.service` — the discovery+entry worker (the part
     that actually does the automation; this is what needs to be running)
   - `comps-web@<user>.service` — the dashboard, on port 3000
3. Edit `.env` (intervals, concurrency, rate limits) and
   `sudo systemctl restart comps-worker@<user>` to apply changes.
4. `journalctl -u comps-worker@<user> -f` to watch it run.

Both services restart automatically on failure and start on boot.

## Status

Profile management, feed- and scraper-based discovery with entry-URL
resolution, the generic + per-site adapter system, the continuous worker,
read-only Gmail win-scanning, and dashboard visibility (competition/entry
counts by status, yield per source) are all in place. Expired competitions
are auto-marked CLOSED on each entry pass. Next: your profile details
(email, address, etc. — not yet provided), the Gmail OAuth setup above if
you want `/wins` active, and any specific sites you want a hand-written
adapter for instead of relying on the generic fallback.
