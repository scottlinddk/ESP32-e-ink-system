import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import 'dotenv/config';
import { createRateLimiter } from './middleware/rateLimit';
import firmwareAssetsRouter from './routes/firmwareAssets';

import healthRouter from './routes/health';
import authRouter from './routes/auth';
import preferencesRouter from './routes/preferences';
import devicesRouter from './routes/devices';
import deviceDisplaysRouter from './routes/deviceDisplays';
import displayDataRouter from './routes/display-data';
import firmwareRouter from './routes/firmware';
import imageRouter from './routes/image';
import { feedRouter, managementRouter as deliveryManagementRouter } from './routes/deviceDelivery';
import customWebhookRouter from './routes/custom-webhook';
import tickersRouter from './routes/tickers';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { swaggerSpec } from './swagger';

const app = express();

// Vercel forwards the public /api/* path unchanged, while every route below is
// mounted without a prefix. Strip it first so the app behaves the same behind
// the platform, a reverse proxy or when run directly.
app.use((req: Request, _res: Response, next: NextFunction) => {
  const stripped = req.url.replace(/^\/api(?=\/|\?|$)/, '');
  if (stripped !== req.url) req.url = stripped.startsWith('/') ? stripped : `/${stripped}`;
  next();
});

// Security middleware
app.use(helmet());

// CORS
const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:5173',
  'http://localhost:5174',
  'https://esp-32-e-ink-system.vercel.app',
  'https://esp-32-e-ink-system-frontend.vercel.app',
  'https://esp32.scottlind.dk',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Display-Width', 'X-Display-Height', 'X-Display-Rotation', 'X-Display-Encoding', 'X-Display-Row-Bytes',
      'X-Preview-Device-ID', 'X-Preview-Layout-ID', 'X-Preview-Layout-Name', 'X-Preview-Mode', 'X-Preview-Rendered-At', 'X-Preview-Quiet', 'X-Preview-Next-Transition'],
  })
);

// Run CORS first so the frontend can read maintenance responses and preflights
// can succeed. Liveness remains available while every application route is
// frozen; GET routes also write (user sync and usage/last-seen data).
app.use('/health', healthRouter);
app.use((_req: Request, res: Response, next: NextFunction) => {
  if (process.env.DATABASE_MAINTENANCE_MODE === 'true') {
    res.setHeader('Retry-After', '300');
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'Database maintenance in progress. Please try again later.' });
    return;
  }
  next();
});

// Rate limiting — backed by Upstash Redis (shared across serverless invocations).
// Gracefully disabled if UPSTASH_REDIS_REST_URL/TOKEN env vars are not set.
const globalLimiter = createRateLimiter(
  100, '15 m',
  'Too many requests, please try again later.',
  'global'
);
const displayLimiter = createRateLimiter(
  10, '1 m',
  'Rate limit exceeded for display data endpoint.',
  'display-data'
);

// Authenticated devices have their own per-device budget so gateways sharing
// one public IP do not spend the browser/dashboard request allowance.
app.use((req, res, next) => req.path.startsWith('/device-feed/') ? next() : globalLimiter(req, res, next));
app.use('/image', displayLimiter);
app.use('/tickers', createRateLimiter(30, '1 m', 'Too many ticker searches, please try again shortly.', 'ticker-search'));

// Body parsing
// A 512x512 one-bit custom image fits within this bounded preferences payload.
app.use('/preferences', express.json({ limit: '64kb' }));
app.use('/devices', express.json({ limit: '40kb' }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

// Public, version-pinned factory images for browser installation.
app.use('/firmware', firmwareAssetsRouter);

// Routes
app.use('/auth', authRouter);
app.use('/preferences', preferencesRouter);
app.use('/devices', devicesRouter);
app.use('/devices', deviceDisplaysRouter);
app.use('/devices', deliveryManagementRouter);
app.use('/device-feed', feedRouter);
app.use('/firmware', firmwareRouter);
app.use('/preview', displayDataRouter);
app.use('/image', imageRouter);
app.use('/custom-webhook', customWebhookRouter);
app.use('/tickers', tickersRouter);

// Checkout stub
app.post('/checkout', (_req, res) => {
  res.status(501).json({
    error: 'Checkout not yet implemented',
    message: 'Stripe integration coming soon',
  });
});

// Swagger UI — override helmet's CSP to allow inline scripts/styles needed by the UI
app.use(
  '/api-docs',
  (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
    );
    next();
  },
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, { explorer: true })
);

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

export default app;
