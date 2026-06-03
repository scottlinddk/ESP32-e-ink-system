import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import 'dotenv/config';
import { createRateLimiter } from './middleware/rateLimit';

import healthRouter from './routes/health';
import authRouter from './routes/auth';
import preferencesRouter from './routes/preferences';
import devicesRouter from './routes/devices';
import displayDataRouter from './routes/display-data';
import firmwareRouter from './routes/firmware';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { swaggerSpec } from './swagger';

const app = express();

// Security middleware
app.use(helmet());

// CORS
const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:5173',
  'http://localhost:5174',
  'https://esp-32-e-ink-system-frontend.vercel.app',
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
  })
);

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
const pairingLimiter = createRateLimiter(
  10, '1 m',
  'Too many pairing requests, please try again later.',
  'device-pair'
);

app.use('/api/', globalLimiter);
app.use('/api/display-data', displayLimiter);
app.use('/api/devices/pair', pairingLimiter);

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

// Firmware binaries — served without auth so browsers can fetch them for esp-web-tools flashing.
// CORS is opened wide (*) here intentionally: these are public binary assets, not API endpoints.
const firmwareBuildsDir = path.join(__dirname, '../../firmware/builds');
app.use(
  '/firmware',
  (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  },
  express.static(firmwareBuildsDir)
);

// Proxy fallback: when DEFAULT_FIRMWARE_URL is set and default.bin is absent locally,
// stream the binary from the configured URL so the browser always hits the same origin.
app.get('/firmware/default.bin', async (_req: Request, res: Response, next: NextFunction) => {
  const url = process.env.DEFAULT_FIRMWARE_URL?.trim();
  if (!url) return next();
  try {
    const { default: fetch } = await import('node-fetch');
    const upstream = await fetch(url, { redirect: 'follow' });
    if (!upstream.ok) return next();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/octet-stream');
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    upstream.body!.pipe(res);
  } catch {
    next();
  }
});

// Routes
app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/preferences', preferencesRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/firmware', firmwareRouter);
app.use('/api/display-data', displayDataRouter);
app.use('/api/preview', displayDataRouter);

// Checkout stub
app.post('/api/checkout', (_req, res) => {
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
