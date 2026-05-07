const { MercadoPagoConfig, PreApproval } = require('mercadopago');
require('dotenv').config();

const mpClient = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN, 
    options: { timeout: 5000 } 
});

async function test() {
    try {
        const preApproval = new PreApproval(mpClient);
        const body = {
            reason: "Suscripción Mensual Alarma Comunitaria",
            external_reference: "1",
            payer_email: "test_user_123@testuser.cl",
            auto_recurring: {
                frequency: 1,
                frequency_type: "months",
                transaction_amount: 1500,
                currency_id: "CLP"
            },
            back_url: "http://127.0.0.1:5173"
        };
        const response = await preApproval.create({ body });
        console.log("Success:", response.init_point);
    } catch (err) {
        console.error("Error creating MP subscription:");
        console.log(err.message);
    }
}
test();
