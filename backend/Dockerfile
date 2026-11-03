# Backend API image for Coolify (built by GitHub Actions, see docs/COOLIFY_DEPLOYMENT.md).
# Build context is the REPOSITORY ROOT because the lockfile lives there:
#   docker build -f backend/Dockerfile -t esp32-eink-backend .

# ---- Build ----
FROM node:22-alpine AS builder
WORKDIR /app

# Every workspace manifest must exist for `npm ci` to validate the root lockfile.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY packages/rendering/package.json packages/rendering/
COPY packages/types/package.json packages/types/
COPY packages/widgets/package.json packages/widgets/
RUN npm ci -w backend --include-workspace-root

COPY backend/tsconfig.json backend/tsconfig.worker.json backend/
COPY backend/src backend/src
COPY backend/api backend/api
RUN npm run build -w backend

# ---- Runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY packages/rendering/package.json packages/rendering/
COPY packages/types/package.json packages/types/
COPY packages/widgets/package.json packages/widgets/
RUN npm ci -w backend --include-workspace-root --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/backend/dist backend/dist

WORKDIR /app/backend
USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["node", "dist/src/index.js"]
