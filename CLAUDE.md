# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Next.js 14 (Pages Router) display app for theDock coworking space. It shows current and upcoming meeting room bookings on lobby screens, pulling data from the OfficeRnD API v2. Hosted on Railway (auto-deploys on push to `main`).

## Commands

```bash
npm run dev          # Dev server on localhost:3000
npm run build        # Production build
npm run start        # Start production (next start)
npm test             # Run Jest tests (uses @swc/jest for transforms)
npm run lint         # ESLint (next/core-web-vitals config)
```

## Environment Variables

Copy `.env.template` to `.env` and fill in the OfficeRnD OAuth2 credentials:
- `OFFICERND_CLIENT_ID` — OAuth2 client ID (required)
- `OFFICERND_CLIENT_SECRET` — OAuth2 client secret (required)
- `OFFICERND_SCOPE` — OAuth2 scopes (optional; falls back to `DEFAULT_SCOPE` in `OfficeRnDService.ts`, which covers the read scopes this app needs)

In production these are set in the Railway project settings.

`DEFAULT_SCOPE` includes `flex.billing.plans.read`, used to identify the coffee add-on service (see [Coffee service add-on](#coffee-service-add-on)). The OAuth client must be granted that scope in OfficeRnD, and if `OFFICERND_SCOPE` is set explicitly it must include it too — otherwise the coffee indicator is silently skipped.

## Architecture

### Data Flow

1. **Frontend** (`pages/index.tsx`) polls `/api/getEvents` every 4 minutes (only between 5am–10pm). Refreshes the clock display every 3 seconds.
2. **API route** (`pages/api/getEvents.ts`) authenticates with OfficeRnD, fetches today's bookings, filters out cancelled/expired events, and separates them into `{started, upcoming}`.
3. **OfficeRnDService** (`src/services/OfficeRnDService.ts`) handles OAuth token acquisition and all OfficeRnD REST calls (bookings, meeting rooms, floors, teams, members). It fetches the booking series overlapping the window, then expands recurring series into concrete occurrences (`expandRecurringBookings`). Has an in-memory cache (3-day TTL) for relatively static data (rooms, floors, teams, members).
4. **OfficeRnDDataAggregator** (`src/services/OfficeRnDDataAggregator.tsx`) joins raw OfficeRnD entities (bookings + rooms + floors + teams + members) into `AppBooking` objects used by the frontend.
5. **processEvents** (`src/misc/dataProcessing/processEvents.ts`) contains `TrimExpiredEvents` and `SeparateStartedAndUpcomingEvents` — pure functions that partition events by time.

### Key Types

- `OfficeRndBooking` — raw API booking shape (`src/services/OfficeRnDTypes/Booking.ts`); includes `extras: [{ _id, count }]` for add-on services
- `AppBooking` — frontend-facing booking with resolved room/floor/host names, plus `coffeeCount` and `hasOwl` (see [Coffee service add-on](#coffee-service-add-on))
- `OfficeRnDPlan` — a plan/membership/service (`src/services/OfficeRnDTypes/Plan.ts`); used to resolve the coffee service by name

### Timezone Handling

Events use `luxon` for timezone-aware date comparison. OfficeRnD bookings carry a `timezone` field (e.g. `America/Vancouver`). The `/api/getEvents` query window is built from `America/Vancouver` day boundaries converted to absolute UTC instants — OfficeRnD interprets bare date strings as UTC midnight, so sending bare dates would shift the window by the venue's UTC offset and drop today's evening bookings.

### Recurring bookings

The OfficeRnD v2 `bookings` endpoint can only be filtered by `seriesStart`/`seriesEnd` (not occurrence `start`/`end`), and it returns a recurring booking as a **single anchor row carrying an `rrule`** — it does not materialize later occurrences. To surface recurring meetings, `OfficeRnDService.getEvents` uses an **overlap query** (`seriesStart[$lt]=windowEnd & seriesEnd[$gte]=windowStart`) to fetch every series touching the window, and `expandRecurringBookings` (`src/services/expandRecurringBookings.ts`) expands each series' `rrule` (via the `rrule` package) into concrete occurrences within the today/tomorrow window. One-off bookings pass through; each recurring occurrence becomes its own booking with a unique `_id`.

Expansion runs in the booking's **own timezone** (the "floating" technique: feed the rule wall-clock times as if UTC, then reinterpret in the zone). OfficeRnD specifies the rule in local time, so this is required for correctness — otherwise an evening booking (whose UTC instant is on the next calendar day) would recur on the wrong weekday, and DST-crossing series would drift by an hour.

Known caveat (acceptable for a lobby display): a single cancelled occurrence within a series isn't represented by the API in a way we detect, so it could still be shown.

### Coffee service add-on

Bookings can have add-on services attached, carried on the raw booking as `extras: [{ _id, count }]`. Each `_id` references an OfficeRnD **plan of `type: "service"`** (not a fee, resource, or rate — those were dead ends); `count` is the quantity, which for the coffee service is the number of people it's for (the plan is "Coffee/Tea Service, per person").

To avoid hardcoding a database id, `OfficeRnDService.getCoffeePlanId` resolves the coffee plan **by name** (first plan matching `/coffee/i`) from the cached `/plans` list (~80 plans, paged 50 at a time; same 3-day cache as other static data). This requires the `flex.billing.plans.read` scope. If the scope is missing or the lookup fails, it returns `null` and the coffee indicator is simply omitted rather than breaking the display.

`OfficeRnDDataAggregator` matches each booking's `extras` against the resolved coffee plan id and sets `AppBooking.coffeeCount` (0 when no coffee). `extras` survives recurring-occurrence expansion via the `{ ...booking }` spread in `expandRecurringBookings`. The frontend (`src/components/event.tsx`) renders `☕ x{count}` on the card when `coffeeCount > 0`.

The **Owl Meeting Pro** add-on works the same way. Its plan id is resolved by name (`/owl/i`) via the shared `OfficeRnDService.resolveServicePlanId` helper (which also backs `getCoffeePlanId`), the aggregator sets `AppBooking.hasOwl` when a booking's `extras` include it, and the frontend renders an owl pill (`OwlIcon`, no count — it's a presence indicator). The coffee and owl pills share `.eventBadge` styling and stack vertically in an `.eventBadges` container when a booking has both.
