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

app.use('/', globalLimiter);
app.use('/image', displayLimiter);

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
// Binary paths are rewritten to same-origin proxy URLs to avoid CORS issues in the browser.
app.get('/firmware/manifest.json', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ghRelease = await fetchLatestFirmwareRelease();
    if (ghRelease) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      res.json(buildManifestFromRelease(ghRelease, firmwareProxyBase(req)));
      return;
    }
    const externalUrl = process.env.DEFAULT_FIRMWARE_URL?.trim();
    if (externalUrl) {
      const version = process.env.DEFAULT_FIRMWARE_VERSION ?? '1.0.0';
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      res.json({
        name: `ESP32 Display v${version}`,
        new_install_prompt_erase: true,
        builds: [{ chipFamily: 'ESP32', parts: [{ path: externalUrl, offset: 65536 }] }],
      });
      return;
    }
  } catch { /* fall through to static */ }
  next();
});

// Returns the public-facing base URL for this backend, including any reverse-proxy
// path prefix (e.g. "/api" when served behind Vercel).  Set BACKEND_PUBLIC_BASE_URL
// in the environment to the full public URL, e.g. "https://esp32.scottlind.dk/api".
function firmwareProxyBase(req: Request): string {
  return process.env.BACKEND_PUBLIC_BASE_URL?.trim()
    || `${req.protocol}://${req.get('host')}`;
}

// Generic proxy: streams a named GitHub release binary to the browser.
// This keeps binary fetches same-origin for esp-web-tools, avoiding CORS issues
// with direct github.com / objects.githubusercontent.com URLs.
async function proxyFirmwareBinary(
  name: string,
  fallbackEnvUrl: string | undefined,
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const urlMap: Record<string, string | null | undefined> = {};
  try {
    const ghRelease = await fetchLatestFirmwareRelease();
    if (ghRelease) {
      urlMap['bootloader.bin'] = ghRelease.bootloaderUrl;
      urlMap['partitions.bin'] = ghRelease.partitionsUrl;
      urlMap['firmware.bin'] = ghRelease.firmwareUrl;
      urlMap['bootloader-elecrow.bin'] = ghRelease.bootloaderElecrowUrl;
      urlMap['partitions-elecrow.bin'] = ghRelease.partitionsElecrowUrl;
      urlMap['firmware-elecrow.bin'] = ghRelease.firmwareElecrowUrl;
    }
  } catch { /* ignore */ }

  const url = urlMap[name] ?? fallbackEnvUrl;
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
}

const defaultFirmwareUrl = () => process.env.DEFAULT_FIRMWARE_URL?.trim();

// Proxy routes for all release binaries — same-origin for the browser, no CORS.
app.get('/firmware/bootloader.bin',         (req, res, next) => proxyFirmwareBinary('bootloader.bin',         undefined,           req, res, next));
app.get('/firmware/partitions.bin',         (req, res, next) => proxyFirmwareBinary('partitions.bin',         undefined,           req, res, next));
app.get('/firmware/firmware.bin',           (req, res, next) => proxyFirmwareBinary('firmware.bin',           defaultFirmwareUrl(), req, res, next));
app.get('/firmware/bootloader-elecrow.bin', (req, res, next) => proxyFirmwareBinary('bootloader-elecrow.bin', undefined,           req, res, next));
app.get('/firmware/partitions-elecrow.bin', (req, res, next) => proxyFirmwareBinary('partitions-elecrow.bin', undefined,           req, res, next));
app.get('/firmware/firmware-elecrow.bin',   (req, res, next) => proxyFirmwareBinary('firmware-elecrow.bin',   undefined,           req, res, next));
// Keep /firmware/default.bin as a backward-compatible alias for firmware.bin.
app.get('/firmware/default.bin',            (req, res, next) => proxyFirmwareBinary('firmware.bin',           defaultFirmwareUrl(), req, res, next));

// Routes
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/preferences', preferencesRouter);
app.use('/devices', devicesRouter);
app.use('/firmware', firmwareRouter);
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
