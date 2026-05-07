const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('c:/Users/jim_c/Desktop/Cosas/Proyectos/alarmas/alarmas/backend/alarmas.db');

db.all("SELECT * FROM cameras", [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log(JSON.stringify(rows, null, 2));
    db.close();
});
