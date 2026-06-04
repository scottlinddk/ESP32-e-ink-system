import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import { Readable } from 'stream';
import 'dotenv/config';
import { createRateLimiter } from './middleware/rateLimit';
import { fetchLatestFirmwareRelease, buildManifestFromRelease } from './services/githubRelease';

import healthRouter from './routes/health';
import authRouter from './routes/auth';
import preferencesRouter from './routes/preferences';
import devicesRouter from './routes/devices';
import displayDataRouter from './routes/display-data';
import firmwareRouter from './routes/firmware';
import imageRouter from './routes/image';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { swaggerSpec } from './swagger';

const app = express();

// Security middleware
app.use(helmet());

// CORS
const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:5173',
  'http://localhost:5174',
  'https://esp-32-e-ink-system.vercel.app',
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

app.use('/', globalLimiter);
app.use('/display-data', displayLimiter);
app.use('/image', displayLimiter);
app.use('/devices/pair', pairingLimiter);

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

// Public manifest for FlashPage: resolves GitHub release assets into a complete multi-part manifest.
app.get('/firmware/manifest.json', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const ghRelease = await fetchLatestFirmwareRelease();
    if (ghRelease) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      res.json(buildManifestFromRelease(ghRelease));
      return;
    }
    const externalUrl = process.env.DEFAULT_FIRMWARE_URL?.trim();
    if (externalUrl) {
      const version = process.env.DEFAULT_FIRMWARE_VERSION ?? '1.0.0';
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      res.json({
        name: `ESP32 Display v${version}`,
        builds: [{ chipFamily: 'ESP32', parts: [{ path: externalUrl, offset: 65536 }] }],
      });
      return;
    }
  } catch { /* fall through to static */ }
  next();
});

// Proxy fallback: resolve the firmware URL dynamically from GitHub releases (preferred)
// or fall back to DEFAULT_FIRMWARE_URL env var, then stream to the browser to avoid CORS issues.
app.get('/firmware/default.bin', async (_req: Request, res: Response, next: NextFunction) => {
  let url: string | undefined;
  try {
    const ghRelease = await fetchLatestFirmwareRelease();
    url = ghRelease?.firmwareUrl;
  } catch { /* ignore */ }
  if (!url) url = process.env.DEFAULT_FIRMWARE_URL?.trim();
  if (!url) return next();
  try {
    const upstream = await fetch(url, { redirect: 'follow' });
    if (!upstream.ok) return next();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/octet-stream');
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
  } catch {
    next();
  }
});

// Routes
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/preferences', preferencesRouter);
app.use('/devices', devicesRouter);
app.use('/firmware', firmwareRouter);
app.use('/display-data', displayDataRouter);
app.use('/preview', displayDataRouter);
app.use('/image', imageRouter);

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
