const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const AxiosDigestAuth = require('axios-digest').default;
const { MercadoPagoConfig, Preference, PreApproval } = require('mercadopago');
const { z } = require('zod');
require('dotenv').config();
const { execFile, exec } = require('child_process');
const fs = require('fs');

// ============================================================
// RTSP → HLS STREAM MANAGER
// ============================================================
const HLS_DIR = path.join(__dirname, 'streams');
if (!fs.existsSync(HLS_DIR)) fs.mkdirSync(HLS_DIR, { recursive: true });

const activeStreams = {}; // { sector: { process, lastViewer, rtspUrl } }

function startHLSStream(sector, rtspUrl) {
    if (activeStreams[sector]) {
        activeStreams[sector].lastViewer = Date.now();
        return;
    }

    const streamDir = path.join(HLS_DIR, sector);
    if (!fs.existsSync(streamDir)) fs.mkdirSync(streamDir, { recursive: true });

    // Limpiar segmentos viejos
    try { fs.readdirSync(streamDir).forEach(f => fs.unlinkSync(path.join(streamDir, f))); } catch(e) {}

    const playlistPath = path.join(streamDir, 'stream.m3u8');
    const segmentPath = path.join(streamDir, 'seg_%03d.ts');

    const ffmpeg = exec(`ffmpeg -rtsp_transport tcp -i "${rtspUrl}" -c:v libx264 -preset ultrafast -tune zerolatency -crf 28 -f hls -hls_time 2 -hls_list_size 5 -hls_flags delete_segments+append_list "${playlistPath}"`, {
        timeout: 0,
        windowsHide: true,
    }, (err) => {
        if (err && err.killed) return;
        if (err) console.error(`[HLS ${sector}] ffmpeg error:`, err.message);
    });

    activeStreams[sector] = { process: ffmpeg, lastViewer: Date.now(), rtspUrl };
    console.log(`📺 [HLS] Stream iniciado para sector: ${sector}`);
}

function stopHLSStream(sector) {
    const stream = activeStreams[sector];
    if (!stream) return;
    try { stream.process.kill('SIGTERM'); } catch(e) {}
    delete activeStreams[sector];
    const streamDir = path.join(HLS_DIR, sector);
    try { fs.rmSync(streamDir, { recursive: true, force: true }); } catch(e) {}
    console.log(`📺 [HLS] Stream detenido: ${sector}`);
}

// Limpiar streams inactivos cada 10 segundos
setInterval(() => {
    const now = Date.now();
    for (const sector in activeStreams) {
        if (now - activeStreams[sector].lastViewer > 30000) {
            stopHLSStream(sector);
        }
    }
}, 10000);

// ============================================================
// RTSP SNAPSHOT — Extrae 1 frame JPEG de un stream RTSP vía ffmpeg
// ============================================================
function grabRTSPSnapshot(rtspUrl) {
    return new Promise((resolve, reject) => {
        const args = [
            '-rtsp_transport', 'tcp',
            '-i', rtspUrl,
            '-vframes', '1',
            '-f', 'image2pipe',
            '-q:v', '3',
            '-timeout', '5000000',
            '-'
        ];
        const ffmpeg = execFile('ffmpeg', args, {
            timeout: 8000,
            maxBuffer: 1024 * 1024 * 5,
            windowsHide: true,
        }, (err, stdout, stderr) => {
            if (err) {
                if (err.killed) return reject(new Error('ffmpeg timeout'));
                return reject(err);
            }
            if (!stdout || stdout.length < 100) return reject(new Error('Frame vacío del stream RTSP'));
            resolve(Buffer.from(stdout));
        });
    });
}

// ============================================================
// FIREBASE ADMIN (desde env var o archivo)
// ============================================================
const admin = require('firebase-admin');
let fcmReady = false;
try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
        serviceAccount = require('./firebase-service-account.json');
    }
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    fcmReady = true;
    console.log("🔥 Firebase Admin inicializado.");
} catch (e) {
    console.log("⚠️ Firebase Admin no inicializado:", e.message);
}

const db = require('./db');

// ============================================================
// JWT SECRET
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('⛔ CRÍTICO: JWT_SECRET no está definido en .env.');
    if (process.env.NODE_ENV === 'production') process.exit(1);
}
const _JWT_SECRET = JWT_SECRET || 'super_secret_alarma_key_SOLO_DESARROLLO';

// ============================================================
// MERCADO PAGO
// ============================================================
const mpClient = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || 'TEST-4739502758193854-050203-9124daaa618a52d2-12345678',
    options: { timeout: 5000 }
});

// ============================================================
// ZOD VALIDATION SCHEMAS
// ============================================================
const loginSchema = z.object({
    phone: z.string().min(1, "Teléfono requerido"),
    password: z.string().min(1, "Contraseña requerida"),
});

const registerSchema = z.object({
    name: z.string().min(1, "Nombre requerido"),
    phone: z.string().min(1, "Teléfono requerido"),
    password: z.string().min(4, "Contraseña muy corta (mín. 4)"),
    address: z.string().min(1, "Dirección requerida"),
    sector: z.string().min(1, "Sector requerido"),
});

const alarmSchema = z.object({
    macAddress: z.string().optional(),
    rfCode: z.string().optional(),
    type: z.string().min(1, "Tipo de alarma requerido"),
    token: z.string().optional(),
    ip: z.string().optional(),
});

const promoCodeSchema = z.object({
    code: z.string().min(1, "Código requerido"),
});

const promoRedeemPaywallSchema = z.object({
    code: z.string().min(1, "Código requerido"),
    phone: z.string().min(1, "Teléfono requerido"),
});

const subscriptionPaywallSchema = z.object({
    phone: z.string().min(1, "Teléfono requerido"),
});

// ============================================================
// MIDDLEWARE DE SUSCRIPCIÓN
// ============================================================
const verifySubscription = async (req, res, next) => {
    if (req.user.role === 'admin') return next();

    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    const now = new Date();
    const expiry = user.subscription_expiry ? new Date(user.subscription_expiry) : null;

    if (!expiry || expiry < now) {
        return res.status(403).json({
            error: "Suscripción vencida",
            code: "SUBSCRIPTION_EXPIRED",
            expiry: user.subscription_expiry
        });
    }
    next();
};

// ============================================================
// RATE LIMITERS
// ============================================================
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: "Demasiados intentos. Intenta de nuevo en 15 minutos." },
    standardHeaders: true,
    legacyHeaders: false,
});

const alarmLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: "Demasiadas alertas. Espera un minuto." },
});

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
});

// ============================================================
// EXPRESS APP
// ============================================================
const isProduction = process.env.NODE_ENV === 'production';
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
const frontendUrl = process.env.FRONTEND_URL || (isProduction ? null : 'http://127.0.0.1:5173');

const app = express();

// Helmet con CSP adaptada para HTTP (sin SSL)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
            connectSrc: ["'self'", "ws:", "wss:", frontendUrl].filter(Boolean),
            frameSrc: ["'self'", "https:", "http:"],
        },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
    strictTransportSecurity: false,
}));

// CORS
const corsOptions = {
    origin: frontendUrl || '*',
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// Rate limiting global (excepto ESP32 que necesita polling frecuente)
app.use('/api/', (req, res, next) => {
    if (req.path.startsWith('/esp/')) return next();
    generalLimiter(req, res, next);
});

// Servir frontend estático en producción
if (isProduction) {
    app.use(express.static(frontendDist));
    console.log(`📦 Sirviendo frontend desde: ${frontendDist}`);
}

// ============================================================
// SOCKET.IO
// ============================================================
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: frontendUrl || '*',
        methods: ["GET", "POST"]
    }
});

// ============================================================
// HEALTH CHECK ENDPOINT
// ============================================================
app.get('/health', async (req, res) => {
    try {
        await db.getAllSectors();
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            whatsapp: whatsAppStatus,
            fcm: fcmReady,
            espDevices: Object.keys(espDevices).length,
            uptime: process.uptime(),
        });
    } catch {
        res.status(503).json({ status: 'error', message: 'Database unavailable' });
    }
});

// ============================================================
// ESTADO GLOBAL
// ============================================================
let espDevices = {};
let activeAlarmIP = null;
let activeAlarmsBySector = {};
let lastAlerts = {};
let pendingCommands = {}; // { macAddress: { action, timestamp } } — cola para ESP32 remotos
let espSnapshots = {}; // { macAddress: { buffer, timestamp } } — último snapshot subido por ESP32
let currentQR = null;
let whatsAppStatus = 'cargando';
let rfListeningFor = null;
let rfListenTimeout = null;
const testModeUsers = new Set();

// ============================================================
// WHATSAPP CLIENT (reinicializable + watchdog)
// ============================================================
let whatsapp = null;
let waReconnectTimer = null;
let waWatchdogTimer = null;
let waQrAttempts = 0;
const WA_MAX_QR_ATTEMPTS = 5;       // Máximo QRs sin escanear antes de pausar
const WA_RECONNECT_DELAY = 15000;   // 15s entre reintentos
const WA_WATCHDOG_INTERVAL = 60000; // Chequeo de salud cada 60s

function createWhatsAppClient() {
    // Limpiar timers anteriores
    clearTimeout(waReconnectTimer);
    clearInterval(waWatchdogTimer);
    waQrAttempts = 0;

    const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

    const client = new Client({
        authStrategy: new LocalAuth(),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-sync',
            '--disable-translate',
            '--disable-default-apps',
            '--mute-audio',
            '--no-first-run',
            '--disable-software-rasterizer',
            '--js-flags="--max-old-space-size=128"',
            '--user-data-dir=/tmp/puppeteer_chromium',
        ],
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    }
    });

    client.on('authenticated', () => {
        console.log('🔑 WhatsApp autenticado correctamente.');
        waQrAttempts = 0;
    });

    client.on('ready', () => {
        currentQR = null;
        waQrAttempts = 0;
        whatsAppStatus = 'conectado';
        io.emit('whatsapp_status', 'conectado');
        console.log('✅ WhatsApp Client is READY');

        // Iniciar watchdog de salud
        clearInterval(waWatchdogTimer);
        waWatchdogTimer = setInterval(async () => {
            try {
                const state = await client.getState();
                if (state !== 'CONNECTED') {
                    console.log(`⚠️ [Watchdog] Estado inesperado: ${state}. Reiniciando...`);
                    scheduleReconnect();
                }
            } catch (err) {
                console.error(`❌ [Watchdog] Cliente no responde: ${err.message}. Reiniciando...`);
                scheduleReconnect();
            }
        }, WA_WATCHDOG_INTERVAL);
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ WhatsApp auth failure:', msg);
        whatsAppStatus = 'auth_failure';
        currentQR = null;
        io.emit('whatsapp_status', 'auth_failure');
        // En auth_failure, la sesión está corrupta — no reintentar automáticamente
    });

    client.on('disconnected', (reason) => {
        console.log('⚠️ WhatsApp DISCONNECTED. Razón:', reason);
        whatsAppStatus = 'desconectado';
        currentQR = null;
        clearInterval(waWatchdogTimer);
        io.emit('whatsapp_status', 'desconectado');
        scheduleReconnect();
    });

    client.on('message', async (msg) => {
        try {
            if (msg.body.startsWith('!vincular') && msg.from.endsWith('@g.us')) {
                const sectorName = msg.body.replace('!vincular', '').trim();
                if (sectorName) {
                    await db.setSectorGroup(sectorName, msg.from);
                    msg.reply(`✅ Sistema enlazado. Las alertas del *${sectorName}* llegarán aquí.`);
                    console.log(`Grupo ${msg.from} vinculado al Sector: ${sectorName}`);
                } else {
                    msg.reply(`❌ Debes especificar el sector. Ejemplo: !vincular Sector Norte`);
                }
            }
        } catch (err) {
            console.error('Error procesando mensaje WA:', err.message);
        }
    });

    console.log('🔄 Inicializando cliente de WhatsApp...');
    client.initialize().catch(e => {
        console.error('Fallo al inicializar WhatsApp:', e.message);
        scheduleReconnect();
    });

    return client;
}

function scheduleReconnect() {
    // Evitar múltiples timers de reconexión simultáneos
    if (waReconnectTimer) return;

    clearInterval(waWatchdogTimer);
    whatsAppStatus = 'reconectando';
    io.emit('whatsapp_status', 'reconectando');

    waReconnectTimer = setTimeout(async () => {
        waReconnectTimer = null;
        console.log('🔄 Reconectando WhatsApp con cliente NUEVO...');

        // Destruir el cliente viejo de forma segura
        try { await whatsapp.destroy(); } catch (e) {}

        whatsAppStatus = 'cargando';
        currentQR = null;
        io.emit('whatsapp_status', 'cargando');
        whatsapp = createWhatsAppClient();
    }, WA_RECONNECT_DELAY);
}

/**
 * Envía un mensaje de WhatsApp de forma segura.
 * Verifica el estado del bot antes de intentar enviar.
 * @returns {boolean} true si se envió exitosamente
 */
async function sendWhatsApp(chatId, message) {
    if (whatsAppStatus !== 'conectado' || !whatsapp) {
        console.log(`⚠️ WhatsApp no disponible (estado: ${whatsAppStatus}). Mensaje no enviado.`);
        return false;
    }
    try {
        await whatsapp.sendMessage(chatId, message);
        return true;
    } catch (err) {
        console.error('❌ Error al enviar WhatsApp:', err.message);
        // Si el error indica desconexión, disparar reconexión
        if (err.message.includes('not ready') || err.message.includes('ECONNREFUSED') || err.message.includes('Session closed')) {
            scheduleReconnect();
        }
        return false;
    }
}

async function restartWhatsApp() {
    clearTimeout(waReconnectTimer);
    waReconnectTimer = null;
    clearInterval(waWatchdogTimer);
    try { await whatsapp.destroy(); } catch(e) {}
    whatsAppStatus = 'cargando';
    currentQR = null;
    io.emit('whatsapp_status', 'cargando');
    whatsapp = createWhatsAppClient();
    console.log('🔄 WhatsApp reiniciado por el administrador');
}

// Arrancar el bot
whatsapp = createWhatsAppClient();

// ============================================================

io.on('connection', (socket) => {
    socket.emit('whatsapp_status', whatsAppStatus);
    if (currentQR) {
        socket.emit('whatsapp_qr', currentQR);
    }
});

// ============================================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================================
const verifyAdmin = async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No autorizado" });
    try {
        const decoded = jwt.verify(token, _JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ error: "Prohibido" });
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ error: "Sesión inválida o expirada" });
    }
};

const verifyUser = async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1] || req.query.token;
    if (!token) return res.status(401).json({ error: "No autorizado" });
    try {
        const decoded = jwt.verify(token, _JWT_SECRET);
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ error: "Sesión inválida o expirada" });
    }
};

// ============================================================
// API ROUTES — AUTH
// ============================================================

app.post('/api/login', authLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { phone, password } = parsed.data;

    const user = await db.getUserByPhone(phone);
    if (!user) return res.status(401).json({ error: "Usuario no encontrado" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Contraseña incorrecta" });

    if (user.role !== 'admin') {
        const now = new Date();
        const expiry = user.subscription_expiry ? new Date(user.subscription_expiry) : null;
        const isActive = user.subscription_status === 'active' && expiry && expiry > now;
        if (!isActive) {
            return res.status(402).json({
                error: "PAYMENT_REQUIRED",
                message: "Tu suscripción ha vencido o no está activa."
            });
        }
    }

    const token = jwt.sign(
        { id: user.id, role: user.role, sector: user.sector, name: user.name },
        _JWT_SECRET,
        { expiresIn: '30d' }
    );
    res.json({ token, role: user.role, name: user.name, sector: user.sector });
});

app.post('/api/register', authLimiter, async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { name, phone, password, address, sector } = parsed.data;

    const existing = await db.getUserByPhone(phone);
    if (existing) return res.status(400).json({ error: "Número de teléfono ya registrado" });

    const authHash = await bcrypt.hash(password, 10);

    try {
        await db.registerUser(name, phone, authHash, address, sector);
        res.json({ status: "Cuenta creada. Inicia sesión para activar tu suscripción." });
    } catch (err) {
        res.status(500).json({ error: "Error al registrar en BD" });
    }
});

// ============================================================
// API ROUTES — RF / IoT
// ============================================================

app.post('/api/rf/listen', verifyAdmin, (req, res) => {
    rfListeningFor = req.body.userId || req.user.id;

    clearTimeout(rfListenTimeout);
    rfListenTimeout = setTimeout(() => {
        rfListeningFor = null;
        io.emit('rf_listen_timeout');
    }, 30000);

    res.json({ status: "Listening for 30s" });
});

app.post('/api/rf/test', verifyAdmin, (req, res) => {
    const targetId = req.body.userId || req.user.id;
    testModeUsers.add(targetId);
    setTimeout(() => testModeUsers.delete(targetId), 30000);
    res.json({ status: "Test mode enabled for 30s" });
});

app.get('/api/rf/controls', verifyUser, async (req, res) => {
    try {
        const controls = await db.getUserControls(req.user.id);
        res.json(controls);
    } catch {
        res.status(500).json({ error: "Error fetch controls" });
    }
});

app.delete('/api/rf/controls/:rfCode', verifyAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        await db.deleteUserControl(userId || req.user.id, req.params.rfCode);
        res.json({ status: "Control desvinculado con éxito" });
    } catch {
        res.status(500).json({ error: "Error al eliminar control" });
    }
});

// ============================================================
// API ROUTES — CCTV / CÁMARAS
// ============================================================

app.get('/api/emergency-view/:sector', verifyUser, verifySubscription, async (req, res) => {
    try {
        const sector = req.params.sector;
        const cam = await db.getCameraBySector(sector);

        if (!cam) {
            return res.status(404).json({ error: "No hay cámara asignada a este sector" });
        }

        if (cam.connection_type === 'p2p_local') {
            const espmac = Object.keys(espDevices).find(m => espDevices[m].sector === sector);
            if (espmac && espSnapshots[espmac] && (Date.now() - espSnapshots[espmac].timestamp < 10000)) {
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
                return res.end(espSnapshots[espmac].buffer);
            }
            return res.status(502).json({ error: "Snapshot no disponible. Esperando al ESP32..." });
        }

        if (cam.connection_type === 'p2p') {
            return res.status(501).json({ error: "Visualización P2P en desarrollo." });
        }

        if (cam.connection_type === 'rtsp') {
            if (!cam.rtsp_url) {
                return res.status(400).json({ error: "Falta la URL RTSP de la cámara" });
            }
            try {
                const imageData = await grabRTSPSnapshot(cam.rtsp_url);
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
                return res.end(imageData);
            } catch (rtspErr) {
                console.error(`❌ ERROR RTSP [${sector}]:`, rtspErr.message);
                return res.status(502).json({ error: "No se pudo capturar frame RTSP" });
            }
        }

        let isapiUrl;
        if (cam.brand === 'dahua') {
            isapiUrl = `http://${cam.ip_address}/cgi-bin/snapshot.cgi?channel=1`;
        } else {
            isapiUrl = `http://${cam.ip_address}/ISAPI/Streaming/channels/1/picture`;
        }

        let imageData;
        try {
            const digestAuth = new AxiosDigestAuth(cam.username, cam.password);
            const response = await digestAuth.get(isapiUrl, {
                responseType: 'arraybuffer',
                timeout: 5000
            });
            imageData = response.data;
        } catch {
            try {
                const authString = Buffer.from(`${cam.username}:${cam.password}`).toString('base64');
                const response = await axios.get(isapiUrl, {
                    headers: { 'Authorization': `Basic ${authString}` },
                    responseType: 'arraybuffer',
                    timeout: 5000
                });
                imageData = response.data;
            } catch {
                return res.status(502).json({ error: "No se pudo conectar a la cámara" });
            }
        }

        if (!imageData || imageData.length === 0) {
            return res.status(502).json({ error: "La cámara no devolvió imagen" });
        }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.end(imageData);
    } catch (err) {
        console.error(`❌ ERROR CCTV [${req.params.sector}]:`, err.message);
        res.status(500).json({ error: "Error interno del servidor de cámaras" });
    }
});

app.get('/api/emergency-view/:sector/:cameraId', verifyUser, verifySubscription, async (req, res) => {
    try {
        const { sector, cameraId } = req.params;
        const allCams = await db.getCamerasBySector(sector);
        const cam = allCams.find(c => c.id === parseInt(cameraId));

        if (!cam) {
            return res.status(404).json({ error: "Cámara no encontrada" });
        }

        if (cam.connection_type === 'p2p_local') {
            const espmac = Object.keys(espDevices).find(m => espDevices[m].sector === sector);
            if (espmac && espSnapshots[espmac] && (Date.now() - espSnapshots[espmac].timestamp < 10000)) {
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
                return res.end(espSnapshots[espmac].buffer);
            }
            return res.status(502).json({ error: "Snapshot no disponible. Esperando al ESP32..." });
        }

        if (cam.connection_type === 'p2p') {
            return res.status(501).json({ error: "Visualización P2P en desarrollo." });
        }

        if (cam.connection_type === 'rtsp') {
            if (!cam.rtsp_url) {
                return res.status(400).json({ error: "Falta la URL RTSP de la cámara" });
            }
            try {
                const imageData = await grabRTSPSnapshot(cam.rtsp_url);
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
                return res.end(imageData);
            } catch (rtspErr) {
                console.error(`❌ ERROR RTSP Cam ${cameraId}:`, rtspErr.message);
                return res.status(502).json({ error: "No se pudo capturar frame RTSP" });
            }
        }

        let isapiUrl;
        if (cam.brand === 'dahua') {
            isapiUrl = `http://${cam.ip_address}/cgi-bin/snapshot.cgi?channel=1`;
        } else {
            isapiUrl = `http://${cam.ip_address}/ISAPI/Streaming/channels/1/picture`;
        }

        let imageData;
        try {
            const digestAuth = new AxiosDigestAuth(cam.username, cam.password);
            const response = await digestAuth.get(isapiUrl, {
                responseType: 'arraybuffer',
                timeout: 5000
            });
            imageData = response.data;
        } catch {
            try {
                const authString = Buffer.from(`${cam.username}:${cam.password}`).toString('base64');
                const response = await axios.get(isapiUrl, {
                    headers: { 'Authorization': `Basic ${authString}` },
                    responseType: 'arraybuffer',
                    timeout: 5000
                });
                imageData = response.data;
            } catch {
                return res.status(502).json({ error: "No se pudo conectar a la cámara" });
            }
        }

        if (!imageData || imageData.length === 0) {
            return res.status(502).json({ error: "La cámara no devolvió imagen" });
        }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.end(imageData);
    } catch (err) {
        console.error(`❌ ERROR CCTV CAM ID [${req.params.cameraId}]:`, err.message);
        res.status(500).json({ error: "Error interno del servidor de cámaras" });
    }
});

// ============================================================
// API ROUTES — FCM TOKENS
// ============================================================

app.post('/api/users/fcm-token', verifyUser, async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: "Token FCM requerido" });
        await db.updateFcmToken(req.user.id, token);
        res.json({ status: "FCM Token actualizado correctamente" });
    } catch {
        res.status(500).json({ error: "Error al actualizar FCM Token" });
    }
});

// ============================================================
// API ROUTES — ESP32 REGISTER
// ============================================================

app.post('/api/esp/register', async (req, res) => {
    const { macAddress, ip } = req.body;
    if (!macAddress || !ip) return res.status(400).json({ error: "macAddress e ip son requeridos" });

    const hwRow = await db.verifyHardware(macAddress);
    const sector = hwRow ? hwRow.sector : 'desconocido';

    espDevices[macAddress] = { ip, sector, lastSeen: Date.now() };
    activeAlarmIP = ip;

    console.log(`📡 [ESP REGISTRADO] MAC: ${macAddress} | IP: ${ip} | Sector: ${sector}`);
    console.log(`   Dispositivos en caché: ${Object.keys(espDevices).length}`);

    res.json({ status: "Registrado", sector });
});

app.post('/api/esp/register', async (req, res) => {
    const { macAddress, ip } = req.body;
    if (!macAddress || !ip) return res.status(400).json({ error: "macAddress e ip son requeridos" });

    const hwRow = await db.verifyHardware(macAddress);
    const sector = hwRow ? hwRow.sector : 'desconocido';

    espDevices[macAddress] = { ip, sector, lastSeen: Date.now() };
    activeAlarmIP = ip;

    console.log(`📡 [ESP REGISTRADO] MAC: ${macAddress} | IP: ${ip} | Sector: ${sector}`);
    console.log(`   Dispositivos en caché: ${Object.keys(espDevices).length}`);

    res.json({ status: "Registrado", sector });
});

// ESP32 sube snapshots de cámara local al droplet
app.post('/api/esp/snapshot', async (req, res) => {
    const mac = (req.query.mac || '').toUpperCase();
    if (!mac) return res.status(400).json({ error: "MAC requerida" });

    const hwRow = await db.verifyHardware(mac);
    if (!hwRow) return res.status(403).json({ error: "MAC no registrada" });

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (buffer.length > 100) {
            espSnapshots[mac] = { buffer, timestamp: Date.now() };
            if (espDevices[mac]) {
                espDevices[mac].lastSeen = Date.now();
            } else {
                espDevices[mac] = { ip: null, sector: hwRow.sector, lastSeen: Date.now() };
            }
        }
        res.sendStatus(200);
    });
});

// ============================================================
// API ROUTES — ALARM (el núcleo del sistema)
// ============================================================

app.post('/api/alarm', alarmLimiter, async (req, res) => {
    const parsed = alarmSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { macAddress, rfCode, type, token, ip } = parsed.data;

    // Throttle de 10 segundos por dispositivo
    if (type !== 'Silenciar' && macAddress && lastAlerts[macAddress] && (Date.now() - lastAlerts[macAddress] < 10000)) {
        return res.status(200).json({ status: "Alert throttled (Anti-spam active)" });
    }
    if (macAddress && type !== 'Silenciar') lastAlerts[macAddress] = Date.now();

    // Actualizar lastSeen del ESP32 (también actualiza IP si cambió)
    if (macAddress && ip) {
        const hwSector = await db.verifyHardware(macAddress);
        if (hwSector) {
            espDevices[macAddress] = { ip, sector: hwSector.sector, lastSeen: Date.now() };
        }
    }

    let neighbor;

    if (macAddress && rfCode) {
        const hwSectorRow = await db.verifyHardware(macAddress);
        if (!hwSectorRow) {
            console.log("ALERTA BLOQUEADA: MAC Address no reconocida:", macAddress);
            return res.status(403).json({ error: "Hardware no registrado." });
        }

        neighbor = await db.getUserByRfCode(rfCode);

        if (!neighbor && rfListeningFor) {
            await db.run(`INSERT OR REPLACE INTO rf_controls (rf_code, user_id) VALUES (?, ?)`, [rfCode, rfListeningFor]);
            console.log(`✅ IOT: Llavero ${rfCode} emparejado al usuario ID: ${rfListeningFor}`);
            io.emit(`rf_paired_success_${rfListeningFor}`, { rfCode });
            rfListeningFor = null;
            clearTimeout(rfListenTimeout);
            return res.status(200).json({ status: "Llavero emparejado y registrado." });
        }

        if (!neighbor) {
            console.log("ALERTA BLOQUEADA: Control RF no reconocido:", rfCode);
            io.emit('rf_sniff_unregistered', { rfCode, macAddress: macAddress || 'Desconocida', timestamp: Date.now() });
            return res.status(404).json({ error: "Control no asociado." });
        }

        const now = new Date();
        const expiry = neighbor.subscription_expiry ? new Date(neighbor.subscription_expiry) : null;
        if (neighbor.role !== 'admin' && (!expiry || expiry < now)) {
            console.log(`ALERTA BLOQUEADA [Suscripción]: ${neighbor.name} suscripción vencida.`);
            return res.status(403).json({ error: "Suscripción vencida." });
        }

        const hwSectorValidation = await db.verifyHardware(macAddress);
        if (!hwSectorValidation || hwSectorValidation.sector !== neighbor.sector) {
            console.log(`ALERTA BLOQUEADA: Sector llavero ('${neighbor.sector}') != Sector MAC ('${hwSectorValidation?.sector}').`);
            return res.status(403).json({ error: "Sector del control no coincide con el sector del dispositivo." });
        }

        io.emit('rf_sniff_registered', {
            rfCode,
            macAddress: macAddress || 'Desconocida',
            neighbor: neighbor.name,
            sector: neighbor.sector,
            timestamp: Date.now()
        });

        if (testModeUsers.has(neighbor.id)) {
            console.log(`✅ TEST: ${neighbor.name} ha pulsado su llavero correctamente.`);
            io.emit(`rf_test_success_${neighbor.id}`, { message: "Conexión Perfecta Llavero-Servidor" });
            testModeUsers.delete(neighbor.id);
            return res.status(200).json({ status: "Test físico registrado exitosamente" });
        }
    } else if (token) {
        try {
            const decoded = jwt.verify(token, _JWT_SECRET);
            neighbor = await db.getUserById(decoded.id);

            const now = new Date();
            const expiry = neighbor.subscription_expiry ? new Date(neighbor.subscription_expiry) : null;
            if (neighbor.role !== 'admin' && (!expiry || expiry < now)) {
                return res.status(403).json({ error: "Suscripción vencida", code: "SUBSCRIPTION_EXPIRED" });
            }
        } catch {
            return res.status(401).json({ error: "Sesión inválida" });
        }
    } else {
        return res.status(400).json({ error: "Datos de solicitud inválidos" });
    }

    if (!neighbor) {
        return res.status(404).json({ error: "Usuario no encontrado." });
    }

    if (ip) {
        activeAlarmIP = ip;
        console.log(`🚨 [CAJA FÍSICA DETECTADA] IP: ${activeAlarmIP} | MAC: ${macAddress || 'N/A'}`);
    }

    await db.logAlarm(neighbor.id, type, neighbor.sector);
    console.log(`🚨 ALERTA RECIBIDA: ${type} de ${neighbor.name} (Sector: ${neighbor.sector})`);

    if (type === 'Silenciar') {
        const triggerUserId = activeAlarmsBySector[neighbor.sector];
        if (neighbor.role !== 'admin' && triggerUserId !== neighbor.id) {
            return res.status(403).json({ error: "Solo el usuario que activó la alarma o un administrador puede silenciarla." });
        }
        delete activeAlarmsBySector[neighbor.sector];

        io.emit('silence_alarm');
        return res.status(200).json({ status: "Alerta Silenciada", data: neighbor, action: "toggle" });
    } else {
        activeAlarmsBySector[neighbor.sector] = neighbor.id;

        io.emit('alarm_trigger', {
            type,
            neighbor: neighbor.name,
            address: neighbor.address,
            sector: neighbor.sector,
            timestamp: new Date()
        });
    }

    // FCM Push
    if (fcmReady && type !== 'Prueba Silenciosa') {
        try {
            const tokensRows = await db.getFcmTokensBySector(neighbor.sector);
            const tokens = tokensRows.map(r => r.fcm_token);
            if (tokens.length > 0) {
                const messagePayload = {
                    notification: {
                        title: `¡ALERTA ROJA EN ${neighbor.sector.toUpperCase()}!`,
                        body: `${neighbor.name} ha disparado una alarma por ${type}.`
                    },
                    android: {
                        priority: 'high',
                        notification: {
                            channelId: 'critical_alerts',
                            sound: 'sirena',
                            clickAction: 'OPEN_EMERGENCY_VIEW'
                        }
                    },
                    data: {
                        sector: neighbor.sector,
                        type: type,
                        triggerBy: neighbor.name
                    },
                    tokens: tokens
                };
                const fcmResponse = await admin.messaging().sendEachForMulticast(messagePayload);
                console.log(`📱 Push FCM: ${fcmResponse.successCount} éxitos, ${fcmResponse.failureCount} fallos.`);
            }
        } catch (fcmErr) {
            console.error("Error Push Notifications:", fcmErr.message);
        }
    }

    // WhatsApp
    try {
        const publicUrl = process.env.PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
        let message = `🚨 *ALERTA DE ${type.toUpperCase()}*\n🏠 *Dirección:* ${neighbor.address}\n👤 *Vecino:* ${neighbor.name}\n📍 *Sector:* ${neighbor.sector}\n━━━━━━━━━━━━━━\n`;

        if (type === 'Prueba Silenciosa') {
            message = `ℹ️ *PRUEBA DE SISTEMA EXITOSA* ℹ️\nSistema en *${neighbor.sector}* monitoreando correctamente.`;
        } else {
            message += `Favor de verificar y dar aviso a las autoridades.`;
        }

        const chatId = await db.getSectorGroup(neighbor.sector);

        if (chatId) {
            const sent = await sendWhatsApp(chatId, message);
            if (sent) {
                console.log(`✅ Alerta enviada a WhatsApp del ${neighbor.sector}`);
            } else {
                console.log(`⚠️ No se pudo enviar alerta WhatsApp al '${neighbor.sector}' (bot desconectado).`);
            }
        } else {
            console.log(`⚠️ No hay grupo suscrito al '${neighbor.sector}'.`);
        }
    } catch (err) {
        console.error("Error al enviar WhatsApp:", err.message);
    }

    // Activar alarma física (ESP32) — intenta HTTP, si no → cola
    if (macAddress && rfCode) {
        return res.status(200).json({ status: "Alerta distribuida", data: neighbor, action: "toggle" });
    }

    let disparado = false;
    const espIP = obtenerIPdelESP(neighbor.sector);
    if (espIP) {
        try {
            console.log(`>> Disparando /activar en ESP32: http://${espIP}/activar`);
            await axios.get(`http://${espIP}/activar`, { timeout: 4000 });
            console.log(`<< Acción física completada en ${neighbor.sector}`);
            disparado = true;
        } catch (err) {
            console.log(`⚠️ HTTP directo falló: ${err.message}. Encolando...`);
        }
    }

    if (!disparado) {
        const espmac = Object.keys(espDevices).find(m => espDevices[m].sector === neighbor.sector);
        if (espmac) {
            pendingCommands[espmac] = { action: 'activar', timestamp: Date.now() };
            console.log(`📋 Comando encolado para ESP ${espmac}: activar`);
        } else {
            console.log(`⚠️ No hay ESP32 registrado para el sector ${neighbor.sector}. Alerta solo digital.`);
        }
    }

    res.status(200).json({ status: "Alerta distribuida", data: neighbor });
});

// ============================================================
// SILENCIAR (FRENO DE MANO)
// ============================================================

app.post('/api/silenciar', verifyUser, async (req, res) => {
    console.log(`Boton del Pánico Silenciado vía Web por: ${req.user.name}`);
    io.emit('silence_alarm');

    // Encolar comando de silencio para TODOS los ESP32s registrados
    let count = 0;
    for (const mac in espDevices) {
        pendingCommands[mac] = { action: 'silenciar', timestamp: Date.now() };
        count++;
    }

    res.json({ status: `Silencio enviado a ${count} dispositivo(s)` });
});

// ============================================================
// API ROUTES — ADMIN HARDWARE
// ============================================================

app.get('/api/admin/hardware', verifyAdmin, async (req, res) => {
    const now = Date.now();
    const hardware = await db.getAllHardware();
    const result = hardware.map(hw => {
        const esp = espDevices[hw.mac_address];
        const online = esp && (now - esp.lastSeen < 300000);
        return {
            ...hw,
            isOnline: online,
            ip: esp ? esp.ip : null,
            lastSeen: esp ? esp.lastSeen : null
        };
    });
    res.json(result);
});

app.post('/api/admin/hardware/scan', verifyAdmin, async (req, res) => {
    // Actualizar estado: online si tuvo actividad en los últimos 2 minutos
    const now = Date.now();
    const hardware = await db.getAllHardware();
    const result = hardware.map(hw => {
        const esp = espDevices[hw.mac_address];
        const online = esp && (now - esp.lastSeen < 300000);
        return { ...hw, isOnline: online, ip: esp ? esp.ip : null, lastSeen: esp ? esp.lastSeen : null };
    });
    res.json(result);
});

app.post('/api/admin/hardware/:mac/action', verifyAdmin, async (req, res) => {
    const { mac } = req.params;
    const { action } = req.body;
    const macUpper = mac.toUpperCase();
    const hwRow = await db.verifyHardware(macUpper);
    if (!hwRow) return res.status(404).json({ error: "Hardware no registrado" });

    // Intentar HTTP directo primero (LAN), si falla → cola de comandos
    const esp = espDevices[macUpper];
    if (esp && esp.ip) {
        try {
            await axios.get(`http://${esp.ip}/${action}`, { timeout: 3000 });
            return res.json({ status: `Instrucción '${action}' completada vía HTTP` });
        } catch {}
    }

    // Modo remoto: encolar comando para que el ESP32 lo recoja vía polling
    pendingCommands[macUpper] = { action, timestamp: Date.now() };
    res.json({ status: `Comando '${action}' encolado. El ESP32 lo ejecutará en ~3s.` });
});

app.get('/api/admin/users', verifyAdmin, async (req, res) => {
    try {
        const users = await db.getAllUsers();
        res.json(users);
    } catch {
        res.status(500).json({ error: "Error al obtener usuarios" });
    }
});

app.post('/api/admin/users/:userId/controls', verifyAdmin, async (req, res) => {
    const { userId } = req.params;
    const { rfCode } = req.body;
    if (!rfCode) return res.status(400).json({ error: "Falta un control RF" });
    try {
        await db.addUserControl(userId, rfCode);
        res.json({ status: "Control agregado correctamente" });
    } catch {
        res.status(500).json({ error: "No se pudo agregar control" });
    }
});

app.delete('/api/admin/users/:userId/controls/:rfCode', verifyAdmin, async (req, res) => {
    const { userId, rfCode } = req.params;
    try {
        await db.deleteUserControl(userId, rfCode);
        res.json({ status: "Control eliminado correctamente" });
    } catch {
        res.status(500).json({ error: "No se pudo eliminar control" });
    }
});

app.put('/api/admin/hardware/:mac', verifyAdmin, async (req, res) => {
    const { mac } = req.params;
    const { alias } = req.body;
    if (alias === undefined) return res.status(400).json({ error: "Se requiere un alias" });
    try {
        await db.updateHardwareAlias(mac.toUpperCase(), alias);
        res.json({ status: "Alias actualizado correctamente" });
    } catch {
        res.status(500).json({ error: "Fallo al actualizar alias" });
    }
});

app.delete('/api/admin/hardware/:mac', verifyAdmin, async (req, res) => {
    try {
        await db.deleteHardwareModule(req.params.mac);
        delete espDevices[req.params.mac];
        res.json({ status: "Hardware eliminado con éxito" });
    } catch {
        res.status(500).json({ error: "Error eliminando" });
    }
});

app.post('/api/admin/hardware', verifyAdmin, async (req, res) => {
    const { macAddress, sector, alias } = req.body;
    if (!macAddress || !sector) return res.status(400).json({ error: "Faltan datos requeridos" });
    await db.addHardwareModule(macAddress.toUpperCase(), sector, alias || '');
    res.json({ status: "Módulo hardware registrado correctamente" });
});

// ============================================================
// API ROUTES — SECTORS
// ============================================================

app.get('/api/sectors', verifyUser, async (req, res) => {
    const sectors = await db.getAllSectors();
    res.json(sectors);
});

app.get('/api/sectors/public', async (req, res) => {
    const sectors = await db.getAllSectors();
    res.json(sectors);
});

app.post('/api/admin/sectors', verifyAdmin, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Nombre del sector es requerido" });
    try {
        await db.addSector(name);
        res.json({ status: "Sector creado correctamente" });
    } catch {
        res.status(500).json({ error: "Error al crear sector" });
    }
});

app.delete('/api/admin/sectors/:name', verifyAdmin, async (req, res) => {
    try {
        await db.deleteSector(req.params.name);
        res.json({ status: "Sector eliminado" });
    } catch {
        res.status(500).json({ error: "Error al eliminar sector" });
    }
});

// ============================================================
// API ROUTES — ADMIN WHATSAPP CONTROL
// ============================================================

app.post('/api/admin/whatsapp/restart', verifyAdmin, async (req, res) => {
    await restartWhatsApp();
    res.json({ status: "WhatsApp reiniciado", whatsAppStatus });
});

app.post('/api/admin/whatsapp/reset', verifyAdmin, async (req, res) => {
    // Borrar sesión guardada y reiniciar desde cero (nuevo QR)
    clearTimeout(waReconnectTimer);
    waReconnectTimer = null;
    clearInterval(waWatchdogTimer);
    try { await whatsapp.destroy(); } catch(e) {}
    try {
        const { execSync } = require('child_process');
        execSync('rm -rf /app/backend/.wwebjs_auth/* 2>/dev/null || true');
    } catch(e) {}
    whatsAppStatus = 'esperando_qr';
    currentQR = null;
    io.emit('whatsapp_status', 'esperando_qr');
    whatsapp = createWhatsAppClient();
    console.log('🔄 WhatsApp reseteado completamente (sesión borrada)');
    res.json({ status: "Sesión borrada. Escanea el nuevo QR.", whatsAppStatus });
});

// ============================================================
// API ROUTES — CAMERAS
// ============================================================

app.get('/api/cameras/:sector', verifyUser, async (req, res) => {
    try {
        const cameras = await db.getCamerasBySector(req.params.sector);
        res.json(cameras.map(c => ({ id: c.id })));
    } catch {
        res.status(500).json({ error: "Error al obtener cámaras" });
    }
});

app.get('/api/admin/cameras', verifyAdmin, async (req, res) => {
    try {
        const cameras = await db.getAllCameras();
        res.json(cameras);
    } catch {
        res.status(500).json({ error: "Error al obtener cámaras" });
    }
});

app.post('/api/admin/cameras', verifyAdmin, async (req, res) => {
    const { sector, brand, stream_link, rtsp_url, connection_type, ip_address, username, password } = req.body;

    if (!sector) {
        return res.status(400).json({ error: "El sector es requerido" });
    }

    try {
        await db.run(
            `INSERT INTO cameras (sector, brand, stream_link, rtsp_url, connection_type, ip_address, username, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [sector, brand || 'hikvision', stream_link || '', rtsp_url || '', connection_type || 'ip', ip_address || '', username || '', password || '']
        );
        res.json({ status: "Cámara registrada correctamente" });
    } catch (err) {
        console.error("Error registrando cámara:", err.message);
        res.status(500).json({ error: "Error al registrar cámara" });
    }
});

app.delete('/api/admin/cameras/:id', verifyAdmin, async (req, res) => {
    try {
        await db.run(`DELETE FROM cameras WHERE id = ?`, [req.params.id]);
        res.json({ status: "Cámara eliminada" });
    } catch {
        res.status(500).json({ error: "Error al eliminar cámara" });
    }
});

// ============================================================
// API ROUTES — STREAMING HLS (RTSP → navegador)
// ============================================================

// Servir archivos HLS estáticos
app.use('/streams', express.static(HLS_DIR, {
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
}));

// Iniciar stream para un sector (devuelve URL del playlist)
app.post('/api/stream/:sector/start', verifyUser, async (req, res) => {
    try {
        const cam = await db.getCameraBySector(req.params.sector);
        if (!cam || !cam.rtsp_url) {
            return res.status(404).json({ error: "No hay cámara RTSP en este sector" });
        }
        startHLSStream(req.params.sector, cam.rtsp_url);
        res.json({ url: `/streams/${req.params.sector}/stream.m3u8` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Heartbeat: mantiene vivo el stream mientras haya espectadores
app.post('/api/stream/:sector/heartbeat', verifyUser, (req, res) => {
    if (activeStreams[req.params.sector]) {
        activeStreams[req.params.sector].lastViewer = Date.now();
    }
    res.json({ active: !!activeStreams[req.params.sector] });
});

// ============================================================
// API ROUTES — SUBSCRIPTION & MERCADO PAGO
// ============================================================

app.post('/api/promo/redeem', verifyUser, async (req, res) => {
    const parsed = promoCodeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Código requerido" });
    const { code } = parsed.data;

    try {
        const result = await db.usePromoCode(code, req.user.id);
        if (!result) return res.status(404).json({ error: "Código inválido, usado o vencido" });
        res.json({ status: "Código canjeado con éxito", newExpiry: result.newExpiry });
    } catch {
        res.status(500).json({ error: "Error al canjear código" });
    }
});

app.post('/api/subscription/create', verifyUser, async (req, res) => {
    try {
        const user = await db.getUserById(req.user.id);
        const preApproval = new PreApproval(mpClient);

        const body = {
            reason: "Suscripción Alarma Comunitaria",
            external_reference: user.id.toString(),
            payer_email: "test_user_123@testuser.cl",
            auto_recurring: {
                frequency: 1,
                frequency_type: "months",
                transaction_amount: 5000,
                currency_id: "CLP"
            },
            back_url: frontendUrl || "http://127.0.0.1:5173"
        };

        const response = await preApproval.create({ body });
        res.json({ init_point: response.init_point });
    } catch (err) {
        console.error("Error creating MP subscription:", err.message);
        res.status(500).json({ error: "Error al crear preferencia de pago" });
    }
});

app.post('/api/subscription/create-paywall', async (req, res) => {
    const parsed = subscriptionPaywallSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Teléfono requerido" });
    const { phone } = parsed.data;
    const planId = req.body.plan_id;

    try {
        const user = await db.getUserByPhone(phone);
        if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

        let amount = 1500;
        let reason = "Suscripción Mensual Alarma Comunitaria";

        if (planId) {
            const plans = await db.getAllPlans();
            const plan = plans.find(p => p.id === parseInt(planId));
            if (plan) {
                amount = plan.price;
                reason = plan.name;
            }
        }

        const preApproval = new PreApproval(mpClient);

        const body = {
            reason,
            external_reference: user.id.toString(),
            payer_email: "test_user_123@testuser.cl",
            auto_recurring: {
                frequency: 1,
                frequency_type: "months",
                transaction_amount: amount,
                currency_id: "CLP"
            },
            back_url: frontendUrl || "http://127.0.0.1:5173"
        };

        const response = await preApproval.create({ body });
        res.json({ init_point: response.init_point });
    } catch (err) {
        console.error("Error creating MP subscription paywall:", err.message);
        res.status(500).json({ error: "Error al generar enlace de pago" });
    }
});

app.post('/api/subscription/webhook', async (req, res) => {
    const { type, data } = req.body;

    if (type === 'subscription_preapproval') {
        try {
            const preApproval = new PreApproval(mpClient);
            const sub = await preApproval.get({ id: data.id });

            if (sub.status === 'authorized') {
                const userId = parseInt(sub.external_reference);
                const expiry = new Date();
                expiry.setMonth(expiry.getMonth() + 1);
                const expiryStr = expiry.toISOString().replace('T', ' ').replace(/\..+/, '');

                await db.updateUserSubscription(userId, 'active', expiryStr, sub.id);
                console.log(`✅ Pago recibido: Usuario ${userId} activado hasta ${expiryStr}`);
            }
        } catch (err) {
            console.error("Error in MP Webhook:", err.message);
        }
    }
    res.sendStatus(200);
});

// ============================================================
// API ROUTES — ADMIN PROMO CODES
// ============================================================

app.get('/api/admin/promo', verifyAdmin, async (req, res) => {
    const codes = await db.getAllPromoCodes();
    res.json(codes);
});

app.post('/api/admin/promo', verifyAdmin, async (req, res) => {
    const { code, days } = req.body;
    if (!code || !days) return res.status(400).json({ error: "Datos incompletos" });
    try {
        await db.generatePromoCode(code, parseInt(days));
        res.json({ status: "Código generado" });
    } catch {
        res.status(500).json({ error: "Error al generar código" });
    }
});

app.post('/api/admin/promo/generate', verifyAdmin, async (req, res) => {
    const { days, prefix } = req.body;
    if (!days) return res.status(400).json({ error: "Días requeridos" });
    const crypto = require('crypto');
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    const code = `${(prefix || 'VEC').toUpperCase()}-${randomPart}`;
    try {
        await db.generatePromoCode(code, parseInt(days));
        res.json({ status: "Código generado automáticamente", code });
    } catch {
        res.status(500).json({ error: "Error al generar código" });
    }
});

app.patch('/api/admin/promo/:id/toggle', verifyAdmin, async (req, res) => {
    const { is_active } = req.body;
    if (is_active === undefined) return res.status(400).json({ error: "Campo is_active requerido" });
    try {
        await db.togglePromoCode(req.params.id, is_active);
        res.json({ status: `Código ${is_active ? 'activado' : 'desactivado'} con éxito` });
    } catch {
        res.status(500).json({ error: "Error al cambiar estado del código" });
    }
});

app.post('/api/promo/redeem-paywall', async (req, res) => {
    const parsed = promoRedeemPaywallSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Código y teléfono requeridos" });
    const { code, phone } = parsed.data;

    try {
        const user = await db.getUserByPhone(phone);
        if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
        const result = await db.usePromoCode(code, user.id);
        if (!result) return res.status(404).json({ error: "Código inválido, desactivado o ya usado" });
        const token = jwt.sign(
            { id: user.id, role: user.role, sector: user.sector, name: user.name },
            _JWT_SECRET,
            { expiresIn: '30d' }
        );
        res.json({ status: "Código canjeado. ¡Bienvenido!", token, role: user.role, name: user.name, sector: user.sector });
    } catch {
        res.status(500).json({ error: "Error al canjear código" });
    }
});

app.put('/api/admin/users/:userId/subscription', verifyAdmin, async (req, res) => {
    const { days } = req.body;
    if (days === undefined) return res.status(400).json({ error: "Días requeridos" });
    try {
        const newExpiry = await db.updateSubscriptionExpiry(req.params.userId, parseInt(days));
        res.json({ status: "Suscripción actualizada", newExpiry });
    } catch {
        res.status(500).json({ error: "Error al actualizar suscripción" });
    }
});

app.delete('/api/admin/users/:userId', verifyAdmin, async (req, res) => {
    try {
        await db.deleteUser(req.params.userId);
        res.json({ status: "Usuario eliminado con éxito" });
    } catch {
        res.status(500).json({ error: "Error al eliminar usuario" });
    }
});

app.put('/api/change-password', verifyUser, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "Ambas contraseñas requeridas" });
    if (newPassword.length < 4) return res.status(400).json({ error: "Nueva contraseña muy corta (mín 4)" });

    try {
        const user = await db.getUserByPhone(req.user.id ? (await db.getUserById(req.user.id))?.phone : null);
        const fullUser = await db.getUserById(req.user.id);
        const valid = await bcrypt.compare(currentPassword, (await db.get(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id])).password_hash);
        if (!valid) return res.status(401).json({ error: "Contraseña actual incorrecta" });

        const newHash = await bcrypt.hash(newPassword, 10);
        await db.changePassword(req.user.id, newHash);
        res.json({ status: "Contraseña actualizada" });
    } catch {
        res.status(500).json({ error: "Error al cambiar contraseña" });
    }
});

app.patch('/api/admin/users/:userId/role', verifyAdmin, async (req, res) => {
    const { role } = req.body;
    if (!role || !['admin', 'user'].includes(role)) return res.status(400).json({ error: "Rol inválido" });
    try {
        if (role === 'admin') await db.promoteToAdmin(req.params.userId);
        else await db.demoteFromAdmin(req.params.userId);
        res.json({ status: `Usuario ${role === 'admin' ? 'promovido a admin' : 'degradado a usuario'}` });
    } catch { res.status(500).json({ error: "Error al cambiar rol" }); }
});

app.get('/api/admin/logs', verifyAdmin, async (req, res) => {
    const logs = await db.getAlarmLogs(200);
    res.json(logs);
});

app.post('/api/admin/logs/clean', verifyAdmin, async (req, res) => {
    const { days } = req.body;
    try {
        await db.cleanOldAlarmLogs(days || 30);
        await db.cleanOldPromoLogs(days || 30);
        res.json({ status: `Registros de más de ${days || 30} días limpiados` });
    } catch { res.status(500).json({ error: "Error al limpiar" }); }
});

// Limpieza automática diaria
setInterval(async () => {
    try { await db.cleanOldAlarmLogs(30); await db.cleanOldPromoLogs(30); } catch {}
}, 86400000);

// ============================================================
// API ROUTES — ESP32 WHITELIST
// ============================================================

app.get('/api/esp/authorized-codes/:mac', async (req, res) => {
    try {
        const { mac } = req.params;
        const hwRow = await db.verifyHardware(mac);
        if (!hwRow) return res.status(403).json({ error: "MAC no registrada" });
        const codes = await db.getAuthorizedRfCodesBySector(hwRow.sector);
        res.json({ sector: hwRow.sector, codes: codes.map(c => c.rf_code) });
    } catch {
        res.status(500).json({ error: "Error al obtener códigos autorizados" });
    }
});

// ============================================================
// API ROUTES — ESP32 COMMAND POLLING (NAT traversal)
// ============================================================

// ESP32 mantiene conexión abierta (long polling) — respuesta instantánea
app.get('/api/esp/pending/:mac', async (req, res) => {
    const mac = req.params.mac.toUpperCase();
    const hwRow = await db.verifyHardware(mac);
    if (!hwRow) return res.status(403).json({ error: "MAC no registrada" });

    // Siempre actualizar lastSeen (incluso si no estaba en caché)
    if (espDevices[mac]) {
        espDevices[mac].lastSeen = Date.now();
    } else {
        espDevices[mac] = { ip: null, sector: hwRow.sector, lastSeen: Date.now() };
    }

    // Si ya hay comando → responder al instante
    const cmd = pendingCommands[mac];
    if (cmd && (Date.now() - cmd.timestamp < 15000)) {
        delete pendingCommands[mac];
        return res.json({ action: cmd.action });
    }

    // Long poll: esperar hasta 25s por un comando nuevo
    const checkInterval = setInterval(() => {
        const newCmd = pendingCommands[mac];
        if (newCmd && (Date.now() - newCmd.timestamp < 15000)) {
            clearInterval(checkInterval);
            delete pendingCommands[mac];
            if (!res.headersSent) res.json({ action: newCmd.action });
        }
    }, 200);

    const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        if (!res.headersSent) res.json({ action: null });
    }, 6000);

    req.on('close', () => {
        clearInterval(checkInterval);
        clearTimeout(timeout);
    });
});

// ============================================================
// API ROUTES — PLANES DE SUSCRIPCIÓN
// ============================================================

app.get('/api/plans', async (req, res) => {
    const plans = await db.getActivePlans();
    res.json(plans);
});

app.get('/api/admin/plans', verifyAdmin, async (req, res) => {
    const plans = await db.getAllPlans();
    res.json(plans);
});

app.post('/api/admin/plans', verifyAdmin, async (req, res) => {
    const { name, description, price, duration_days, currency } = req.body;
    if (!name || !price || !duration_days) return res.status(400).json({ error: "Nombre, precio y duración requeridos" });
    try {
        await db.createPlan(name, description || '', parseInt(price), parseInt(duration_days), currency || 'CLP');
        res.json({ status: "Plan creado" });
    } catch { res.status(500).json({ error: "Error al crear plan" }); }
});

app.patch('/api/admin/plans/:id', verifyAdmin, async (req, res) => {
    const { is_active } = req.body;
    if (is_active === undefined) return res.status(400).json({ error: "is_active requerido" });
    try {
        await db.togglePlan(req.params.id, is_active);
        res.json({ status: "Plan actualizado" });
    } catch { res.status(500).json({ error: "Error" }); }
});

app.delete('/api/admin/plans/:id', verifyAdmin, async (req, res) => {
    try {
        await db.deletePlan(req.params.id);
        res.json({ status: "Plan eliminado" });
    } catch { res.status(500).json({ error: "Error" }); }
});

// ============================================================
// SPA FALLBACK — Sirve index.html para rutas del frontend
// ============================================================
if (isProduction) {
    app.get('/{*splat}', (req, res) => {
        res.sendFile(path.join(frontendDist, 'index.html'));
    });
}

// ============================================================
// UTILITARIO: obtener IP del ESP por sector
// ============================================================
function obtenerIPdelESP(sector) {
    for (const mac in espDevices) {
        if (espDevices[mac].sector === sector) {
            return espDevices[mac].ip;
        }
    }
    const macs = Object.keys(espDevices);
    if (macs.length === 1) {
        return espDevices[macs[0]].ip;
    }
    return activeAlarmIP;
}

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3001;

process.on('uncaughtException', (err) => {
    console.error('⚠️ [CRASH EVITADO] Excepción no capturada:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ [CRASH EVITADO] Promesa rechazada:', reason);
});

db.initDB().then(() => {
    server.listen(PORT, () => {
        console.log(`📡 Servidor Backend Activo en http://localhost:${PORT}`);
        if (isProduction) {
            console.log(`🌐 Modo PRODUCCIÓN — Frontend servido desde: ${frontendDist}`);
        }
    });
}).catch(err => {
    console.error("Error al iniciar DB:", err);
    process.exit(1);
});
