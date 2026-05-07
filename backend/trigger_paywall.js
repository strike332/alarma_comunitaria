const axios = require('axios');

async function test() {
    try {
        console.log("Sending request to paywall...");
        const response = await axios.post('http://localhost:3001/api/subscription/create-paywall', {
            phone: '123456789'
        });
        console.log("Success:", response.data);
    } catch (err) {
        console.error("Error:", err.message);
        if (err.response) {
            console.error("Response:", err.response.data);
        }
    }
}
test();
