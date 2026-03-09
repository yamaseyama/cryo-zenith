require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function checkLeads() {
    try {
        await client.connect();
        const res = await client.query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 5;');
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

checkLeads();
