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

async function exportCafesToCSV(tableName) {
  const csvWriter = createCsvWriter({
    path: "cafes.csv",
    header: [
      {id: "id", title: "id"},
      {id: "type", title: "type"},
      {id: "website", title: "website"},
      {id: "lattitude", title: "lattitude"},
      {id: "longitude", title: "longitude"},
      {id: "name", title: "name"},
      {id: "address", title: "address"},
      {id: "_allOsmResults", title: "_allOsmResults"},
      {id: "hours", title: "hours"},
      {id: "price", title: "price"},
      {id: "reviewsWebsite", title: "reviewsWebsite"},
      {id: "amenities", title: "amenities"}
    ]
  });

  const jsonData = await convertToJSON(tableName);
  const cafesData = jsonData.filter(item => item.attribute === 'type' && item.value === 'cafe').map(item => ({id: item.object}));

  jsonData.forEach(item => {
    if (cafesData.find(cafe => cafe.id === item.object)) {
      cafesData.find(cafe => cafe.id === item.object)[item.attribute] = item.value;
    }
  });

  csvWriter.writeRecords(cafesData)
    .then(() => console.log("Generated cafes.csv successfully!"))
    .catch(err => console.error("Error writing CSV for cafes", err));
}

exportCafesToCSV(tableName)

async function exportEventsToCSV(tableName) {
  const csvWriter = createCsvWriter({
    path: "events.csv",
    header: [
      {id: "id", title: "id"},
      {id: "type", title: "type"},
      {id: "startDate", title: "startDate"},
      {id: "endDate", title: "endDate"},
      {id: "name", title: "name"},
      {id: "url", title: "url"},
      {id: "image", title: "image"},
      {id: "description", title: "description"},
      {id: "locationName", title: "locationName"},
      {id: "locationAddress", title: "locationAddress"},
      {id: "organizerName", title: "organizerName"}
    ]
  });

  const jsonData = await convertToJSON(tableName);
  const eventsData = jsonData
    .filter(item => item.attribute === 'type' && item.value === 'event')
    .map(item => ({id: item.object}));

  jsonData.forEach(item => {
    if (eventsData.find(event => event.id === item.object)) {
      eventsData.find(event => event.id === item.object)[item.attribute] = item.value;
    }
  });

  csvWriter.writeRecords(eventsData)
    .then(() => console.log("Generated events.csv successfully!"))
    .catch(err => console.error("Error writing CSV for events", err));
}

exportEventsToCSV(tableName)

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
