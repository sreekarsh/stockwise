# Multi-stage Docker build for StockWise
# Stage 1: Client build with Vite (minified, tree-shaken output)
FROM node:20-slim AS client-build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY vite.config.ts ./
COPY tsconfig.client.json ./
COPY js/ ./js/
COPY types/ ./types/
COPY index.html ./
COPY pages/ ./pages/
COPY css/ ./css/

RUN npx vite build --outDir client-dist

# Stage 2: Server build (compile TS to JS for production)
FROM node:20-slim AS server-build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsconfig.prod.json ./
COPY server.ts ./
COPY config/ ./config/
COPY middleware/ ./middleware/
COPY routes/ ./routes/
COPY services/ ./services/
COPY prisma/ ./prisma/
COPY types/ ./types/

RUN npx prisma generate
RUN npx tsc --project tsconfig.prod.json --outDir server-dist

# Final stage: combine everything
FROM python:3.11-slim

# Install Node.js 20 + OpenSSL (use official Node Binary Distribution)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg openssl xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz \
    | tar -xJ -C /usr/local --strip-components=1 \
    && node --version

# Install Python ML dependencies
RUN pip install --no-cache-dir --upgrade pip
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /app

# Copy compiled server (server-dist/* → dist/*)
COPY --from=server-build /app/server-dist ./dist
COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/prisma ./prisma
COPY --from=server-build /app/package.json ./

# Copy Vite-built client bundle (client-dist/* → dist/* — no overlap with server files)
COPY --from=client-build /app/client-dist ./dist

# Copy ML engine
COPY ml_engine/ ./ml_engine/

# Copy migration script
COPY scripts/migrate.sh ./scripts/

# Copy static assets (CSS, pages HTML, images)
COPY css/ ./css/
COPY pages/ ./pages/
COPY index.html ./

# Regenerate Prisma Client for this platform's OpenSSL version
RUN npx prisma generate

# Production health check — validates DB connectivity
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{const j=JSON.parse(b);process.exit(j.database==='connected'?0:1)}catch{process.exit(1)}})}).on('error',()=>process.exit(1))"

EXPOSE 3000

CMD sh -c "npx prisma migrate deploy && node dist/server.js"
