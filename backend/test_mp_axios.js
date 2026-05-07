const axios = require('axios');
require('dotenv').config();

async function test() {
    try {
        const response = await axios.post('https://api.mercadopago.com/preapproval', {
            reason: "Suscripción Mensual Alarma Comunitaria",
            external_reference: "1",
            payer_email: "test_user_123@testuser.cl",
            auto_recurring: {
                frequency: 1,
                frequency_type: "months",
                transaction_amount: 1500,
                currency_id: "CLP"
            },
            back_url: "https://google.com"
        }, {
            headers: {
                Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log("Success:", response.data);
    } catch (err) {
        console.error("Error:");
        console.log(err.response ? JSON.stringify(err.response.data, null, 2) : err.message);
    }
}
test();
