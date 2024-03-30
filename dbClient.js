const { Client } = require('pg');
require('dotenv').config()

async function withDbClient(operation) {
  const dbConfig = new Client({
    user: process.env.CLIENT_USER,
    host: process.env.CLIENT_HOST,
    password: process.env.CLIENT_PASSWORD,
    port: Number(process.env.CLIENT_PORT),
    database: process.env.CLIENT_DB
  });

  try {
    await dbConfig.connect();
	await dbConfig.query("SET client_encoding TO 'UTF8';");
    await operation(dbConfig);
  } finally {
    await dbConfig.end();
  }
}

module.exports = withDbClient;
