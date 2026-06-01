# Setup Guide — Track A: Self-Hosted / Development

This guide covers running the ESP32 Display SaaS stack locally for development.

## Prerequisites

- Node.js 20+
- npm 10+
- A [Supabase](https://supabase.com) project
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
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS) |
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

1. Open your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Paste the contents of `backend/src/db/migrations/001_initial.sql`
4. Click **Run**

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

### "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
Check that your `.env` has both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

### CORS errors in the browser
Make sure `FRONTEND_URL` in `backend/.env` matches the URL your frontend is running on.
