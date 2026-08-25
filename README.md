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
  loudly, not work around it.
- **Respects each competition's own entry cap.** `Competition.maxEntries`
  records how many entries that competition allows per person; the runner
  won't submit past it.
- **No auto-consent.** Adapters must not tick marketing/data-sharing consent
  boxes on your behalf.

## Stack

- Next.js (App Router) + TypeScript — dashboard for profile & entry history
- Prisma + SQLite — profile, tracked competitions, entry log
- Playwright — drives the per-site adapters
- A standalone runner (`npm run run:entries`) meant to be invoked on a
  schedule (cron, systemd timer, etc.) for unattended operation

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

## Status

This is the initial scaffold: profile management, competition tracking, the
adapter interface, and the runner loop are in place. No real site adapters
exist yet — those get added once we know which specific giveaways/platforms
to target.
