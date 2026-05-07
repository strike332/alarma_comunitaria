const { initDB } = require('./db');

(async () => {
    const db = await initDB();
    
    // Ver cámara actual
    const cam = await db.get('SELECT * FROM cameras WHERE id = 2');
    console.log('Actual:', cam?.rtsp_url);
    
    // Corregir RTSP URL con la contraseña correcta
    const rtspUrl = 'rtsp://admin:Ine$2026@_@192.168.1.17:554/cam/realmonitor?channel=1&subtype=0';
    await db.run('UPDATE cameras SET rtsp_url = ? WHERE id = 2', [rtspUrl]);
    
    const updated = await db.get('SELECT rtsp_url FROM cameras WHERE id = 2');
    console.log('Corregido:', updated.rtsp_url);
    
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
