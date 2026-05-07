const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const bcrypt = require('bcryptjs'); // ✅ Importado una vez al inicio

let db;

async function initDB() {
    const dbPath = process.env.DB_PATH || './alarmas.db';
    console.log(`📂 Base de datos: ${dbPath}`);
    db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    // Usuarios del sistema
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            address TEXT NOT NULL,
            sector TEXT DEFAULT 'General',
            role TEXT DEFAULT 'user',
            subscription_status TEXT DEFAULT 'trial',
            subscription_expiry DATETIME,
            mp_customer_id TEXT,
            mp_preapproval_id TEXT,
            fcm_token TEXT
        );
    `);
    
    // Migración para bases de datos existentes
    try { await db.exec("ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'trial';"); } catch(e) {}
    try { await db.exec("ALTER TABLE users ADD COLUMN subscription_expiry DATETIME;"); } catch(e) {}
    try { await db.exec("ALTER TABLE users ADD COLUMN mp_customer_id TEXT;"); } catch(e) {}
    try { await db.exec("ALTER TABLE users ADD COLUMN mp_preapproval_id TEXT;"); } catch(e) {}
    try { await db.exec("ALTER TABLE users ADD COLUMN fcm_token TEXT;"); } catch(e) {}

    // Tabla de Códigos Promocionales
    await db.exec(`
        CREATE TABLE IF NOT EXISTS promo_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            duration_days INTEGER NOT NULL,
            is_used INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            used_by_user_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(used_by_user_id) REFERENCES users(id)
        );
    `);
    // Migración para bases de datos existentes
    try { await db.exec("ALTER TABLE promo_codes ADD COLUMN is_active INTEGER DEFAULT 1;"); } catch(e) {}

    // Módulos Físicos ESP32 de Alarma
    await db.exec(`
        CREATE TABLE IF NOT EXISTS hardware_modules (
            mac_address TEXT PRIMARY KEY,
            sector TEXT NOT NULL,
            alias TEXT DEFAULT ''
        );
    `);
    try { await db.exec("ALTER TABLE hardware_modules ADD COLUMN alias TEXT DEFAULT '';"); } catch(e) {}


    // Cámaras IP Hikvision / Dahua / ONVIF / P2P
    await db.exec(`
        CREATE TABLE IF NOT EXISTS cameras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sector TEXT NOT NULL,
            ip_address TEXT,
            username TEXT,
            password TEXT,
            brand TEXT DEFAULT 'hikvision',
            connection_type TEXT DEFAULT 'ip',
            p2p_id TEXT,
            p2p_channel INTEGER DEFAULT 1,
            stream_link TEXT,
            rtsp_url TEXT
        );
    `);
    try { await db.exec("ALTER TABLE cameras ADD COLUMN brand TEXT DEFAULT 'hikvision';"); } catch(e) {}
    try { await db.exec("ALTER TABLE cameras ADD COLUMN connection_type TEXT DEFAULT 'ip';"); } catch(e) {}
    try { await db.exec("ALTER TABLE cameras ADD COLUMN p2p_id TEXT;"); } catch(e) {}
    try { await db.exec("ALTER TABLE cameras ADD COLUMN p2p_channel INTEGER DEFAULT 1;"); } catch(e) {}
    try { await db.exec("ALTER TABLE cameras ADD COLUMN stream_link TEXT;"); } catch(e) {}
    try { await db.exec("ALTER TABLE cameras ADD COLUMN rtsp_url TEXT;"); } catch(e) {}

    // Mapeo de Controles Remotos RF al Usuario
    await db.exec(`
        CREATE TABLE IF NOT EXISTS rf_controls (
            rf_code TEXT PRIMARY KEY,
            user_id INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
    `);

    // Gestión de Sectores y links de WhatsApp
    await db.exec(`
        CREATE TABLE IF NOT EXISTS sectors (
            name TEXT PRIMARY KEY,
            whatsapp_group_id TEXT
        );
    `);

    // Historial y Auditoría
    await db.exec(`
        CREATE TABLE IF NOT EXISTS alarm_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            user_id INTEGER,
            event_type TEXT,
            sector TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
    `);

    // Insertar un Admin de prueba si la tabla está vacía
    const count = await db.get(`SELECT COUNT(*) as count FROM users`);
    if (count.count === 0) {
        const adminHash = await bcrypt.hash('123456', 10);
        // Expiración infinita para el admin (año 2099)
        await db.run(
            `INSERT INTO users (name, phone, password_hash, address, sector, role, subscription_status, subscription_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            ['Administrador General', 'admin', adminHash, 'Sede Central', 'General', 'admin', 'active', '2099-12-31 23:59:59']
        );
        
        // Un usuario de prueba normal con 7 días de trial
        const userHash = await bcrypt.hash('1234', 10);
        const trialExpiry = new Date();
        trialExpiry.setDate(trialExpiry.getDate() + 7);
        const expiryStr = trialExpiry.toISOString().replace('T', ' ').replace(/\..+/, '');

        const res = await db.run(
            `INSERT INTO users (name, phone, password_hash, address, sector, role, subscription_status, subscription_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            ['Doña Marta', '123456789', userHash, 'Calle Las Lomas 23', 'Sector Norte', 'user', 'trial', expiryStr]
        );
        
        // Simular un RF Code para Doña Marta
        await db.run(`INSERT INTO rf_controls (rf_code, user_id) VALUES (?, ?)`, ['15661730', res.lastID]);
        
        // Simular la MAC de un equipo en la calle
        await db.run(`INSERT INTO hardware_modules (mac_address, sector) VALUES (?, ?)`, ['A8:42:E3:AA:E1:DC', 'Sector Norte']);

        // Registrar la cámara IP Hikvision de pruebas vinculada al mismo Sector Norte
        await db.run(
            `INSERT INTO cameras (sector, ip_address, username, password, brand, connection_type, stream_link) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['Sector Norte', '192.168.1.64', 'admin', 'stain1570', 'hikvision', 'ip', '']
        );

        console.log('📦 Base de datos v3 inicializada (Suscripciones + Códigos Promo).');
    }
    
    return db;
}

// ---- Consultas ---

async function getUserByPhone(phone) {
    return await db.get(`SELECT * FROM users WHERE phone = ?`, [phone]);
}

async function getUserById(id) {
    // ✅ FIX #8: Incluir subscription_expiry y role para verificación de suscripción
    return await db.get(`SELECT id, name, phone, address, sector, role, subscription_expiry FROM users WHERE id = ?`, [id]);
}

async function deleteUser(id) {
    // ✅ FIX #6: La tabla correcta es 'rf_controls', no 'user_controls'
    await db.run('DELETE FROM rf_controls WHERE user_id = ?', [id]);
    return await db.run('DELETE FROM users WHERE id = ?', [id]);
}

async function verifyHardware(macAddress) {
    return await db.get(`SELECT sector FROM hardware_modules WHERE mac_address = ?`, [macAddress]);
}

async function getCameraBySector(sector) {
    return await db.get(`SELECT ip_address, username, password, brand, connection_type, p2p_id, p2p_channel, stream_link FROM cameras WHERE sector = ?`, [sector]);
}

// Nueva: devuelve TODAS las cámaras de un sector para navegación entre cámaras
async function getCamerasBySector(sector) {
    return await db.all(`SELECT id, ip_address, username, password, brand, connection_type, p2p_id, p2p_channel, stream_link FROM cameras WHERE sector = ? ORDER BY id ASC`, [sector]);
}

// Nueva: devuelve TODAS las cámaras del sistema (para Admin Panel)
async function getAllCameras() {
    return await db.all(`SELECT * FROM cameras ORDER BY sector, id ASC`);
}

async function getUserByRfCode(rfCode) {
    return await db.get(`
        SELECT u.id, u.name, u.phone, u.address, u.sector 
        FROM rf_controls r
        JOIN users u ON r.user_id = u.id
        WHERE r.rf_code = ?
    `, [rfCode]);
}

async function getUserControls(userId) {
    return await db.all(`SELECT rf_code FROM rf_controls WHERE user_id = ?`, [userId]);
}

async function deleteUserControl(userId, rfCode) {
    await db.run(`DELETE FROM rf_controls WHERE user_id = ? AND rf_code = ?`, [userId, rfCode]);
}

async function setSectorGroup(sectorName, groupId) {
    await db.run(
        `INSERT OR REPLACE INTO sectors (name, whatsapp_group_id) VALUES (?, ?)`,
        [sectorName, groupId]
    );
}

async function addSector(name) {
    await db.run(`INSERT OR IGNORE INTO sectors (name) VALUES (?)`, [name]);
}

async function deleteSector(name) {
    // Nota: Esto no borra usuarios o hardware vinculados, solo el sector de la lista global.
    await db.run(`DELETE FROM sectors WHERE name = ?`, [name]);
}

async function getSectorGroup(sectorName) {
    const row = await db.get(`SELECT whatsapp_group_id FROM sectors WHERE name = ?`, [sectorName]);
    return row ? row.whatsapp_group_id : null;
}

async function getAllSectors() {
    return await db.all(`SELECT name FROM sectors`);
}

async function logAlarm(userId, eventType, sector) {
    await db.run(
        `INSERT INTO alarm_logs (user_id, event_type, sector) VALUES (?, ?, ?)`,
        [userId, eventType, sector]
    );
}

// Funciones nuevas para Admin Panel
async function getAllUsers() {
    const users = await db.all(`SELECT id, name, phone, address, sector, role, subscription_status, subscription_expiry FROM users`);
    const controls = await db.all(`SELECT rf_code, user_id FROM rf_controls`);
    users.forEach(u => {
        u.controls = controls.filter(c => c.user_id === u.id).map(c => c.rf_code);
    });
    return users;
}

async function getAllHardware() {
    return await db.all(`SELECT * FROM hardware_modules`);
}

async function addHardwareModule(macAddress, sector, alias = '') {
    await db.run(
        `INSERT OR REPLACE INTO hardware_modules (mac_address, sector, alias) VALUES (?, ?, ?)`,
        [macAddress, sector, alias]
    );
    // Registrar el sector globalmente si es que es un nombre nuevo
    await db.run(
        `INSERT OR IGNORE INTO sectors (name) VALUES (?)`,
        [sector]
    );
}

async function deleteHardwareModule(macAddress) {
    await db.run(`DELETE FROM hardware_modules WHERE mac_address = ?`, [macAddress]);
}

async function updateHardwareAlias(mac, alias) {
    await db.run(`UPDATE hardware_modules SET alias = ? WHERE mac_address = ?`, [alias, mac]);
}

async function registerUser(name, phone, passwordHash, address, sector) {
    // Sin trial. El usuario debe pagar o canjear un código para acceder.
    const res = await db.run(
        `INSERT INTO users (name, phone, password_hash, address, sector, role, subscription_status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, phone, passwordHash, address, sector, 'user', 'inactive']
    );
    return res.lastID;
}

async function addUserControl(userId, rfCode) {
    await db.run(`INSERT OR REPLACE INTO rf_controls (rf_code, user_id) VALUES (?, ?)`, [rfCode, userId]);
}

// --- Gestión de Suscripciones y Códigos Promo ---

async function getPromoCode(code) {
    // Solo devuelve códigos que NO han sido usados Y están activos
    return await db.get(`SELECT * FROM promo_codes WHERE code = ? AND is_used = 0 AND is_active = 1`, [code]);
}

async function usePromoCode(code, userId) {
    const promo = await getPromoCode(code);
    if (!promo) return null;

    const user = await getUserById(userId);
    let currentExpiry = user.subscription_expiry ? new Date(user.subscription_expiry) : new Date();
    if (currentExpiry < new Date()) currentExpiry = new Date(); // Si ya venció, empezar desde hoy

    currentExpiry.setDate(currentExpiry.getDate() + promo.duration_days);
    const newExpiryStr = currentExpiry.toISOString().replace('T', ' ').replace(/\..+/, '');

    await db.run(`UPDATE users SET subscription_status = 'active', subscription_expiry = ? WHERE id = ?`, [newExpiryStr, userId]);
    await db.run(`UPDATE promo_codes SET is_used = 1, used_by_user_id = ? WHERE code = ?`, [userId, code]);
    
    return { newExpiry: newExpiryStr };
}

async function updateUserSubscription(userId, status, expiryDate, mpPreapprovalId = null) {
    await db.run(
        `UPDATE users SET subscription_status = ?, subscription_expiry = ?, mp_preapproval_id = ? WHERE id = ?`,
        [status, expiryDate, mpPreapprovalId, userId]
    );
}

async function updateSubscriptionExpiry(userId, days) {
    const user = await getUserById(userId);
    let currentExpiry = user.subscription_expiry ? new Date(user.subscription_expiry) : new Date();
    
    currentExpiry.setDate(currentExpiry.getDate() + days);
    const newExpiryStr = currentExpiry.toISOString().replace('T', ' ').replace(/\..+/, '');
    
    await db.run(`UPDATE users SET subscription_expiry = ? WHERE id = ?`, [newExpiryStr, userId]);
    return newExpiryStr;
}

async function getAllPromoCodes() {
    return await db.all(`SELECT p.*, u.name as used_by_name FROM promo_codes p LEFT JOIN users u ON p.used_by_user_id = u.id ORDER BY p.created_at DESC`);
}

async function generatePromoCode(code, durationDays) {
    await db.run(`INSERT INTO promo_codes (code, duration_days) VALUES (?, ?)`, [code, durationDays]);
}

async function updateFcmToken(userId, token) {
    await db.run(`UPDATE users SET fcm_token = ? WHERE id = ?`, [token, userId]);
}

async function getFcmTokensBySector(sector) {
    return await db.all(`SELECT fcm_token FROM users WHERE sector = ? AND fcm_token IS NOT NULL AND fcm_token != ''`, [sector]);
}

async function togglePromoCode(id, isActive) {
    await db.run(`UPDATE promo_codes SET is_active = ? WHERE id = ?`, [isActive ? 1 : 0, id]);
}

async function getAuthorizedRfCodesBySector(sector) {
    // Devuelve todos los RF codes de usuarios activos de un sector
    return await db.all(`
        SELECT r.rf_code FROM rf_controls r
        JOIN users u ON r.user_id = u.id
        WHERE u.sector = ? AND (u.subscription_status = 'active' OR u.role = 'admin')
    `, [sector]);
}

module.exports = {
    initDB,
    getUserByPhone,
    getUserById,
    deleteUser,
    verifyHardware,
    getUserByRfCode,
    setSectorGroup,
    getSectorGroup,
    logAlarm,
    getAllUsers,
    getAllSectors,
    getAllHardware,
    addHardwareModule,
    deleteHardwareModule,
    updateHardwareAlias,
    registerUser,
    addUserControl,
    getUserControls,
    deleteUserControl,
    getCameraBySector,
    getCamerasBySector,
    getAllCameras,
    addSector,
    deleteSector,
    getPromoCode,
    usePromoCode,
    updateUserSubscription,
    updateSubscriptionExpiry,
    getAllPromoCodes,
    generatePromoCode,
    togglePromoCode,
    getAuthorizedRfCodesBySector,
    updateFcmToken,
    getFcmTokensBySector,
    run: async (sql, params) => await db.run(sql, params),
    get: async (sql, params) => await db.get(sql, params)
};
