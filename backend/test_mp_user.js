const axios = require('axios');
require('dotenv').config();

async function test() {
    try {
        const response = await axios.get('https://api.mercadopago.com/users/me', {
            headers: {
                Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
            }
        });
        console.log("Site ID:", response.data.site_id);
    } catch (err) {
        console.error("Error:", err.message);
    }
}
test();
