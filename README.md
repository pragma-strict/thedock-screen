# theDock Screen

A lobby display for [theDock](https://www.thedockvictoria.com/) coworking space. Shows current and upcoming meeting room bookings on TV screens throughout the building.

Built with Next.js 14 (Pages Router) and the [OfficeRnD API v2](https://developer.officernd.com/docs).

**Production:** https://thedock-screen-production.up.railway.app/

## Getting Started

```bash
npm install
```

Copy `.env.template` to `.env` and fill in your OfficeRnD credentials:

```bash
cp .env.template .env
```

Then start the dev server:

```bash
npm run dev
```

Open http://localhost:3000.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OFFICERND_CLIENT_ID` | Yes | OfficeRnD OAuth2 client ID |
| `OFFICERND_CLIENT_SECRET` | Yes | OfficeRnD OAuth2 client secret |
| `OFFICERND_SCOPE` | No | OAuth2 scopes (defaults to the read scopes this app needs) |

## Deployment

Hosted on [Railway](https://railway.app/). Deploys automatically on push to `main`.

Set `OFFICERND_CLIENT_ID` and `OFFICERND_CLIENT_SECRET` as environment variables in the Railway project settings.
