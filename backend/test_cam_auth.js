const axios = require('axios');
const AxiosDigestAuth = require('axios-digest').default;

const cam = {
    ip_address: "192.168.100.101",
    username: "admin",
    password: "jpbb3121",
    brand: "dahua"
};

const digestAuth = new AxiosDigestAuth({
    username: cam.username,
    password: cam.password
});

const isapiUrl = `http://${cam.ip_address}/cgi-bin/snapshot.cgi?channel=1`;

console.log(`Intentando capturar desde ${isapiUrl}...`);

digestAuth.request({
    method: 'GET',
    url: isapiUrl,
    responseType: 'arraybuffer',
    timeout: 5000
}).then(res => {
    console.log("✅ ÉXITO: Imagen capturada. Tamaño:", res.data.length);
}).catch(err => {
    console.error("❌ ERROR:", err.message);
    if (err.response) {
        console.error("Status:", err.response.status);
    }
});
