const axios = require('axios');
const AxiosDigestAuth = require('axios-digest').default;

const cam = {
    ip_address: "192.168.100.101",
    username: "admin",
    password: "jpbb3121",
    brand: "dahua"
};

const isapiUrl = `http://${cam.ip_address}/cgi-bin/snapshot.cgi?channel=1`;

async function test() {
    console.log(`[TEST] Marca: ${cam.brand} | URL: ${isapiUrl}`);
    const digestAuth = new AxiosDigestAuth(cam.username, cam.password);

    try {
        const response = await digestAuth.get(isapiUrl, {
            responseType: 'arraybuffer',
            timeout: 5000
        });
        console.log("✅ ÉXITO: Respuesta recibida.");
        console.log("Status:", response.status);
        console.log("Tamaño data:", response.data.length);
        console.log("Headers:", response.headers['content-type']);
    } catch (err) {
        console.error("❌ ERROR:", err.message);
        if (err.response) {
            console.error("Status:", err.response.status);
            console.error("Data:", err.response.data.toString());
        }
    }
}

test();
