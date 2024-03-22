const withDbClient = require('./dbClient');
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

// This is the tableName
const tableName = 'poidata';
if (!tableName) {
  process.exit(1);
}

async function convertToJSON(tableName) {
  return new Promise(async (resolve, reject) => {
    await withDbClient(async (client) => {
      try {
        const res = await client.query(`SELECT * FROM ${tableName};`);
        console.log(`Contents of the ${tableName} table:`);
        const jsonData = JSON.parse(JSON.stringify(res.rows));
        resolve(jsonData);
      } catch (err) {
        console.log("err message: ", err.message);
        console.error("Error running query", err.stack);
        reject(err); 
      }
    });
  });
}


// const jsonData = convertToJSON(tableName)

async function exportToCSV(tableName) {
  const csvWriter = createCsvWriter({
    path: "geo-poi-scraper.csv",
    header: [
      { id: "rowid", title: "rowid" },
      { id: "object", title: "object" },
      { id: "attribute", title: "attribute" },
      { id: "value", title: "value" },
      { id: "attributetype", title: "attributetype" }
    ]
  });

  const jsonData = await convertToJSON(tableName).then((res) => {
    // console.log("res: ", res)
    csvWriter.writeRecords(res).then(() =>
      console.log("Write to geo-poi-scraper.csv successfully!")
    );
  })
}

exportToCSV(tableName)


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

async function getObjectAttributesByUuid(uuid) {
  await withDbClient(async (client) => {
    try {
      const queryStr = 'SELECT attribute, value, attributeType FROM poiData WHERE object = $1;';
      const res = await client.query(queryStr, [uuid]);
      
      if (res.rows.length === 0) {
        console.log('No data found for the given UUID.');
        return null;
      }

      console.log(`Attributes and values for object UUID ${uuid}:`);
      console.table(res.rows);
      return res.rows;
    } catch (err) {
      console.error('Error running query', err.stack);
      return null;
    }
  });
}

// getObjectAttributesByUuid('787123fc-4150-4c94-b4a9-0cf821f9b9b1').then(data => console.log(data));

async function findEntityIdByCriteria(type, locationName, nameContains) {
  await withDbClient(async (client) => {
    try {
      // A complex SQL query to find an object (entity) based on criteria across multiple rows
      const queryStr = `
        SELECT object FROM poiData WHERE object IN (
          SELECT object FROM poiData WHERE attribute = 'type' AND value = $1
        ) AND object IN (
          SELECT object FROM poiData WHERE attribute = 'locationName' AND value = $2
        ) AND object IN (
          SELECT object FROM poiData WHERE attribute = 'name' AND value ILIKE $3
        )
        LIMIT 1;
      `;

      const res = await client.query(queryStr, [type, locationName, `%${nameContains}%`]);

      if (res.rows.length > 0) {
        console.log(`Found entity. Object ID: ${res.rows[0].object}`);
        return res.rows[0].object; 
      } else {
        console.log('No entities found matching the criteria.');
        return null;
      }
    } catch (err) {
      console.error('Error running query', err.stack);
      return null;
    }
  });
}

// findEntityIdByCriteria('event', 'The Savoy Tivoli', 'Legal Hackers Happy Hour');


// viewTableContent(tableName);
// resetPoiDataTable()
