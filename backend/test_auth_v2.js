const AxiosDigest = require('axios-digest').default;

try {
    const auth = new AxiosDigest("admin", "jpbb3121");
    console.log("Instancia creada con éxito.");
    console.log("Métodos disponibles:", Object.keys(auth));
    console.log("Prototype:", Object.keys(Object.getPrototypeOf(auth)));
    
    if (typeof auth.request === 'function') {
        console.log("✅ .request existe");
    } else {
        console.log("❌ .request NO existe");
    }
} catch (e) {
    console.error("Error al crear instancia:", e.message);
}
