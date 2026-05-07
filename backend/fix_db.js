const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('c:/Users/jim_c/Desktop/Cosas/Proyectos/alarmas/alarmas/backend/alarmas.db');

db.serialize(() => {
    // Añadir columna brand si no existe
    db.run("ALTER TABLE cameras ADD COLUMN brand TEXT DEFAULT 'hikvision'", (err) => {
        if (err) {
            console.log("La columna brand ya existe o hubo un error:", err.message);
        } else {
            console.log("Columna brand añadida correctamente.");
        }
        
        // Actualizar la cámara existente a Dahua (ya que vimos que responde a Dahua)
        db.run("UPDATE cameras SET brand = 'dahua' WHERE ip_address = '192.168.100.101'", (err) => {
            if (err) console.error(err);
            else console.log("Cámara 192.168.100.101 actualizada a Dahua.");
            db.close();
        });
    });
});
