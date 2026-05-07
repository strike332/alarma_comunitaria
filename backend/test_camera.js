const AxiosDigestAuth = require('axios-digest').default;

const testCamera = async () => {
    try {
        console.log("Iniciando test hacia la cámara...");
        const digestAuth = new AxiosDigestAuth({
            username: 'admin',
            password: 'stain1570'
        });
        
        const response = await digestAuth.request({
            method: 'GET',
            url: 'http://192.168.100.64/ISAPI/Streaming/channels/101/picture',
            responseType: 'arraybuffer'
        });
        console.log("¡ÉXITO! Recibidos", response.data.length, "bytes de imagen.");
    } catch (err) {
        console.error(">>> ERROR FATAL <<<");
        console.error("Mensaje:", err.message);
        if (err.response) {
            console.error("Status HTTP:", err.response.status);
            console.error("Response Body:", err.response.data.toString());
        }
    }
};

testCamera();
