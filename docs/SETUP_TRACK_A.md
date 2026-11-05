# Setup Guide — Track A: Self-Hosted / Development

> **Partly historical.** The original version of this guide used a Supabase project. The API now
> connects directly to PostgreSQL with `DATABASE_URL`; the current database setup is in
> [DATABASE.md](DATABASE.md) and the production path in [COOLIFY_DEPLOYMENT.md](COOLIFY_DEPLOYMENT.md).
> Sections 2 and 3 below are updated; the rest is unchanged.

This guide covers running the ESP32 Display SaaS stack locally for development.

## Prerequisites

- Node.js 20+
- npm 10+
- A PostgreSQL 14+ database you can create roles in (a local container is fine)
- A [Clerk](https://clerk.com) application
- (Optional) OpenWeatherMap API key
- (Optional) NewsAPI key

## 1. Clone and install

```bash
cd energy-display-saas

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

## 2. Configure environment variables

### Backend

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

| Variable | Description |
|---|---|
| `PORT` | Port to run the API on (default: 3001) |
| `DATABASE_URL` | `postgresql://eink_app:<password>@localhost:5432/eink` (the application role, see below) |
| `DATABASE_SSL` | `disable` for a local database; leave unset (`verify-full`) for a TLS server |
| `CLERK_SECRET_KEY` | Clerk secret key (starts with `sk_`) |
| `OPENWEATHERMAP_API_KEY` | Fallback OpenWeatherMap key (optional) |
| `NEWS_API_KEY` | Fallback NewsAPI key (optional) |

### Frontend

```bash
cp frontend/.env.example frontend/.env
```

Edit `frontend/.env`:

| Variable | Description |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (starts with `pk_`) |
| `VITE_API_BASE_URL` | Backend API base URL (default: `http://localhost:3001`) |

## 3. Run the database migration

As the database owner, apply every file in `backend/src/db/migrations/` in filename order (both
`002_*.sql` files), then create the application role and give it a password:

```bash
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/db/roles/app-role.sql
psql "$ADMIN_DATABASE_URL" -c '\password eink_app'
```

The migrations expect the roles `anon`, `authenticated` and `service_role` to exist (empty `NOLOGIN`
roles are enough). See [DATABASE.md](DATABASE.md#what-the-schema-still-requires).

## 4. Configure Clerk

1. Create a Clerk application at [clerk.com](https://clerk.com)
2. In **JWT Templates**, create a template if needed (default Clerk JWT works)
3. Set the following in your Clerk dashboard:
   - **Allowed redirect URLs**: `http://localhost:5173`
   - **Sign-in URL**: `/login`
   - **Sign-up URL**: `/signup`
   - **After sign-in URL**: `/dashboard`

## 5. Start the development servers

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:5173`.
The backend API will be available at `http://localhost:3001`.

## 6. Verify the setup

```bash
# Health check
curl http://localhost:3001/health

# Response:
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 12.345
}
```

## 7. TypeScript type checking

```bash
cd backend && npm run typecheck
cd frontend && npm run typecheck
```

## Troubleshooting

### "CLERK_SECRET_KEY environment variable is not set"
Make sure your `.env` file is in the `backend/` directory and contains `CLERK_SECRET_KEY`.

### "DATABASE_URL environment variable is required" or a 503 from `/health/ready`
Check `DATABASE_URL` and `DATABASE_SSL` in `backend/.env`. `GET /health/ready` returns a coarse reason
(`authentication_failed`, `tls_error`, `unreachable`, ...); the API log has a hint. See [DATABASE.md](DATABASE.md).

### CORS errors in the browser
Make sure `FRONTEND_URL` in `backend/.env` matches the URL your frontend is running on.
