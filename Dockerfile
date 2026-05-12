# ============================================================
# DOCKERFILE — Alarma Comunitaria (Backend + Frontend)
# DigitalOcean App Platform / Droplet
# ============================================================

FROM node:20

# Instalar Chromium para whatsapp-web.js + ffmpeg para RTSP + dumb-init para señales
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    dumb-init \
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
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_FLAGS="--no-sandbox --disable-gpu --disable-dev-shm-usage"
ENV NODE_ENV=production

WORKDIR /app

# Instalar dependencias del frontend y hacer build
COPY frontend/ ./frontend/
RUN cd frontend && npm ci && cd .. && cd frontend && npx vite build && cd ..

# Instalar dependencias del backend (compilar sqlite3 desde fuente)
COPY backend/ ./backend/
RUN cd backend && npm ci --build-from-source && cd ..

# Crear directorios para volúmenes persistentes y shared memory
RUN mkdir -p /data /tmp/wwebjs_auth

# Exponer puerto
EXPOSE 3001

# Usar dumb-init para manejar señales correctamente (evita zombies de Chromium)
WORKDIR /app/backend
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
