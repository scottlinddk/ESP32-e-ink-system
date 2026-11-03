# Frontend (Vite SPA) image for Coolify. Build context is the REPOSITORY ROOT:
#   docker build -f frontend/Dockerfile \
#     --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_... -t esp32-eink-frontend .

# ---- Build ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY packages/rendering/package.json packages/rendering/
COPY packages/types/package.json packages/types/
COPY packages/widgets/package.json packages/widgets/
RUN npm ci -w frontend --include-workspace-root

COPY frontend frontend

# VITE_* values are inlined at build time, so they are build args, not runtime env.
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN npm run build -w frontend

# ---- Runtime ----
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
