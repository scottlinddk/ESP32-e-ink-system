# Energy Display SaaS

A web dashboard + API for connecting your ESP32 e-ink display to live energy prices, weather, and news headlines.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, TypeScript, TanStack Query v5, shadcn/ui, Tailwind CSS 3, Clerk |
| Backend | Node.js 20, Express, TypeScript, Supabase, Clerk |
| Database | Supabase (PostgreSQL) |
| Auth | Clerk |
| Hardware | ESP32 + Waveshare 2.13" e-Paper |

## Project Structure

```
energy-display-saas/
├── frontend/          React dashboard app
├── backend/           Express API server
└── docs/              Setup and reference docs
```

## Quick Start

### Prerequisites
- Node.js 20+
- Supabase project
- Clerk application

### Install & run

```bash
# Backend
cd backend
cp .env.example .env   # fill in your keys
npm install
npm run dev            # http://localhost:3001

# Frontend
cd frontend
cp .env.example .env   # fill in your Clerk publishable key
npm install
npm run dev            # http://localhost:5173
```

### Database

Run `backend/src/db/migrations/001_initial.sql` in your Supabase SQL editor.

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Health check |
| POST | `/api/auth/login` | Clerk JWT | Sync user to DB |
| GET | `/api/auth/user` | Clerk JWT | Get current user |
| GET | `/api/preferences` | Clerk JWT | Get display preferences |
| POST | `/api/preferences` | Clerk JWT | Update preferences |
| GET | `/api/preferences/api-keys` | Clerk JWT | List stored API keys |
| POST | `/api/preferences/api-keys` | Clerk JWT | Save API key |
| GET | `/api/display-data/:userId` | License Key | Device data endpoint |
| GET | `/api/preview` | Clerk JWT | Dashboard preview |

## Data Sources

- **Energy prices**: [Energinet](https://www.energidataservice.dk/) — free, no key required
- **Weather**: [OpenWeatherMap](https://openweathermap.org/) — free tier, key required
- **News**: [NewsAPI](https://newsapi.org/) — free developer tier, key required

## Docs

- [Setup Guide](docs/SETUP_TRACK_A.md) — local development setup
- [Firmware Flashing](docs/FIRMWARE_FLASHING.md) — ESP32 hardware setup
- [API Reference](docs/API_REFERENCE.md) — full endpoint documentation
