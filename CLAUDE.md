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

## Architecture

### Data Flow

1. **Frontend** (`pages/index.tsx`) polls `/api/getEvents` every 4 minutes (only between 5am–10pm). Refreshes the clock display every 3 seconds.
2. **API route** (`pages/api/getEvents.ts`) authenticates with OfficeRnD, fetches today's bookings, filters out cancelled/expired events, and separates them into `{started, upcoming}`.
3. **OfficeRnDService** (`src/services/OfficeRnDService.ts`) handles OAuth token acquisition and all OfficeRnD REST calls (bookings, meeting rooms, floors, teams, members). Has an in-memory cache (3-day TTL) for relatively static data (rooms, floors, teams, members).
4. **OfficeRnDDataAggregator** (`src/services/OfficeRnDDataAggregator.tsx`) joins raw OfficeRnD entities (bookings + rooms + floors + teams + members) into `AppBooking` objects used by the frontend.
5. **processEvents** (`src/misc/dataProcessing/processEvents.ts`) contains `TrimExpiredEvents` and `SeparateStartedAndUpcomingEvents` — pure functions that partition events by time.

### Key Types

- `OfficeRndBooking` — raw API booking shape (`src/services/OfficeRnDTypes/Booking.ts`)
- `AppBooking` — frontend-facing booking with resolved room/floor/host names

### Timezone Handling

Events use `luxon` for timezone-aware date comparison. OfficeRnD bookings carry a `timezone` field (e.g. `America/Vancouver`) and filtering uses Luxon's `DateTime.fromISO` with zone awareness.
