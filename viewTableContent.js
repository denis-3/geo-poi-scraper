const withDbClient = require('./dbClient');

async function viewTableContent(tableName) {
  await withDbClient(async (client) => {
    try {
      const res = await client.query(`SELECT * FROM ${tableName};`);
      console.log(`Contents of the ${tableName} table:`);
      console.table(res.rows);
    } catch (err) {
      console.log("err message: ", err.message)
      console.error("Error running query", err.stack);
    }
  });
}

// This is the tableName
const tableName = 'poidata'; 
if (!tableName) {
  process.exit(1);
}

viewTableContent(tableName);
