# ============================================================
# DOCKERFILE — Alarma Comunitaria (Backend + Frontend)
# DigitalOcean App Platform / Droplet
# ============================================================

FROM node:20-slim

# Instalar herramientas de compilación para módulos nativos (sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
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
COPY frontend/ ./frontend/
RUN cd frontend && npm ci && cd .. && cd frontend && npx vite build && cd ..

# Instalar dependencias del backend y copiar código
COPY backend/ ./backend/
RUN cd backend && npm ci --omit=dev && cd ..

# Crear directorios para volúmenes persistentes
RUN mkdir -p /data

# Exponer puerto
EXPOSE 3001

# Iniciar servidor
WORKDIR /app/backend
CMD ["node", "server.js"]
