# Airport Transfer Dispatch

Enter a booking, get a one-click grouping/assignment recommendation,
work it on a dispatch board, drivers see and act on their jobs from a
private link. Built for real, ongoing use — not just a demo.

## Get it live (real bookings, entirely free)

Two free accounts, $0 total. ~10-15 minutes.

**1. Database — Neon (free Postgres, never expires)**
1. [neon.tech](https://neon.tech) → sign up (no card) → create a project.
2. Copy the connection string (`postgresql://user:pass@ep-xxxx.neon.tech/dbname?sslmode=require`).

**2. Code — GitHub (free)**
1. [github.com](https://github.com) → new repository.
2. **Add file → Upload files**, drag in everything from this unzipped folder, commit.

**3. Hosting — Render, free plan**
1. [render.com](https://render.com) → sign up (no card).
2. **New → Blueprint**, connect the repo. Render reads `render.yaml`
   and configures itself, prompting for two things:
   - `DATABASE_URL` → paste the Neon connection string.
   - `ACCESS_CODE` → make up a passcode for the dispatch board (see below).
3. Click **Apply**.

`render.yaml` is set to Render's free plan: $0/month. The tradeoff is
that it sleeps after 15 minutes with no visitors, and the next person
to open the link waits ~30-60 seconds while it wakes up - after that
it runs normally until it goes idle again. If that delay ever becomes
a problem, change `plan: free` to `plan: starter` in `render.yaml`
(~$7/month, always-on) and redeploy - nothing else about the app
changes.

**4. That's it — open the app**
Render's build step creates the database tables automatically (no
command to run on your computer, no Node.js to install — everything
happens in Render's cloud). Once the build finishes, open your Render
URL, enter the `ACCESS_CODE` you set, go to **Fleet setup**, add a
vehicle and a driver, copy that driver's link, and you're taking real
bookings.

## Who can access what

- **Dispatch board** (`/`) — gated behind the `ACCESS_CODE` passcode
  you set in Render. Anyone dispatching bookings needs it.
- **Driver links** (`/driver/:token`) — no passcode. Each driver gets
  their own private, hard-to-guess link from Fleet setup and can only
  update bookings assigned to them.
- If you don't set `ACCESS_CODE` at all (e.g. running locally), the
  dispatch board has no gate — convenient for local dev, not for
  anything public.

## What was fixed vs. the previous build

The data model previously had no reliable way to show a driver **two**
combined bookings at once (a `drivers.currentBookingId` field can only
point to one row). Here, a driver's job list is always derived by
querying `bookings` where `driverId` = them and status is
`assigned`/`en_route` — never a single pointer — so a combined trip
can't hide a passenger. Covered by `test_flow.py` and
`server/matching.test.ts`.

## How grouping works

`server/matching.ts` is a small, pure, unit-tested rule engine (no LLM
call). Not airport-specific — pickup and dropoff can be anywhere, and
flight number/airport code are optional fields used only for reference
when a job happens to involve a flight. Two bookings combine if they
share **either** a pickup point or a dropoff point (same starting
point going different ways, or different starting points converging
on the same destination), within a 15-minute window, with enough
seats. It checks two kinds of candidates, in order:
1. A booking that **already has a driver** - joins that trip if the
   combined party still fits the vehicle (least disruptive, driver's
   already briefed).
2. If none, another **still-unassigned** booking - proposes assigning
   both together to a fresh driver. This covers bookings arriving back
   to back before you've had a chance to accept the first one.

If neither applies, it proposes a solo assignment to the smallest
available vehicle that fits the party. `npm test` proves all of this,
including capacity limits, outside-time-window rejection, a third
passenger joining an existing group, two brand-new bookings pairing
with each other, non-airport point-to-point jobs, and rejecting to get
the next-best option.

Location matching tolerates small typos ("Heathrow Terminl 5" still
matches "Heathrow Terminal 5") but treats anything that looks like an
identifier - numbers, single letters - as needing to match exactly.
This is deliberate: "Terminal 3" and "Terminal 5" are one character
apart but different physical locations, so a naive text-similarity
match would wrongly combine passengers headed to different places.
Numbers/short codes must match exactly; ordinary words can absorb a
couple of wrong or missing letters. When a match wasn't spelled
identically, the recommendation says so ("spelled slightly
differently, matched automatically") so you can glance-check it.

## Deleting a booking

Any booking card on the dispatch board has a delete (trash) icon. This
sets it to a `cancelled` status (not shown on the board), releases the
driver if one was assigned, and clears any pending recommendation tied
to it. The driver's own view updates immediately if they had it.

## Error messages

Every error the server can throw - a blank required field, no driver
available for a recommendation, trying to delete a driver mid-job - is
returned as a plain sentence, not a raw error code or stack trace.
Internal stack traces never leave the server.

## Stack

React 19 + Vite, Express + tRPC, Drizzle ORM (Postgres), WebSockets for
live push, Tailwind v4.

## Running it locally

```bash
npm install
cp .env.example .env   # DATABASE_URL to Postgres (Neon or local); ACCESS_CODE optional
npm run db:push
npm run dev             # http://localhost:5173
```

## Verifying it works

```bash
npm test                 # unit tests for the matching engine
npx tsc --noEmit          # typecheck
ACCESS_CODE=yourcode python3 test_flow.py   # end-to-end test against a running server + DB
```

`test_flow.py` proves, against a real database: the passcode blocks
unauthorized dispatch access, John gets solo-assigned, Jane (same
hotel, 5 min later) gets correctly recommended to group with him,
after accepting both the driver's job list shows both passengers, and
the driver can update their own jobs using only their own link — no
passcode needed.

## Known limitations (by design, given MVP scope)

- Location matching tolerates typos but still isn't real geocoding —
  "Hotel A, London" won't match "near Hotel A" or a genuinely different
  way of describing the same place (e.g. "the airport Hilton" vs
  "Hilton T5"). It matches close spelling, not synonyms.
- No per-admin accounts — one shared passcode for whoever dispatches.
  Fine for a small operation; if you need to know *which* dispatcher
  did what, that's a bigger addition.
- WebSocket reconnects automatically but there's no offline queue.
