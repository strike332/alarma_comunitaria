# ============================================================
# DOCKERFILE — Alarma Comunitaria (Backend + Frontend)
# DigitalOcean App Platform / Droplet
# ============================================================

FROM node:20-slim

# Instalar Chromium para whatsapp-web.js + ffmpeg para RTSP
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Instalar dependencias del frontend y hacer build
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci && cd ..

# Copiar y buildear frontend
COPY frontend/ ./frontend/
RUN cd frontend && npx vite build

# Instalar dependencias del backend (solo producción)
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev && cd ..

# Copiar backend
COPY backend/ ./backend/

# Crear directorios para volúmenes persistentes
RUN mkdir -p /data

# Exponer puerto
EXPOSE 3001

# Iniciar servidor
WORKDIR /app/backend
CMD ["node", "server.js"]
