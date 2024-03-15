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

async function resetPoiDataTable() {
	await withDbClient(async client => {
		try {
			await client.query('DROP TABLE poiData')
			console.log("Deleted table")
		} catch {
			console.log("Table does not exist to drop")
		}
		await client.query("CREATE TABLE poiData(rowId SERIAL, object TEXT, attribute TEXT, value TEXT, attributeType TEXT)")
		console.log("Created table again")
	})
}

// This is the tableName
const tableName = 'poidata';
if (!tableName) {
  process.exit(1);
}

viewTableContent(tableName);
// resetPoiDataTable()
