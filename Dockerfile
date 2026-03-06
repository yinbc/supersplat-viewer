# Stage 1: Build frontend assets
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src/ ./src/
COPY rollup.config.mjs tsconfig.json serve.json ./
RUN npm run build

# Stage 2: Production image
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built frontend from builder stage
COPY --from=builder /app/public ./public

# Copy server and static files
COPY server.js ./
COPY static/ ./static/

# Create uploads directory
RUN mkdir -p /app/uploads

# Uploads volume for persistent storage
VOLUME /app/uploads

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]
