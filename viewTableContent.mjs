import Postgres from 'pg'
import { dbConfig } from './main.mjs';

const client = new Postgres.Client(dbConfig);

async function viewTableContents(tableName) {
  try {
    await client.connect();
    const res = await client.query(`SELECT * FROM ${tableName};`);
    console.log(`Contents of the ${tableName} table:`);
    console.table(res.rows);
  } catch (err) {
    console.error("Error running query", err.stack);
  } finally {
    await client.end();
  }
}

// This is the tableName
const tableName = 'poidata'; 
if (!tableName) {
  process.exit(1);
}

viewTableContents(tableName);

