const withDbClient = require('./dbClient');
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

// This is the tableName
const tableName = 'poidata';
if (!tableName) {
  process.exit(1);
}

function prepareContentForCsv(content) {
  if (typeof content !== 'string') {
    return '';
  }
  // Replace <br><br> with \n for newlines in the CSV content
  let csvContent = content.replace(/<br><br>/g, '\n');

  // Escape double quotes by doubling them
  csvContent = csvContent.replace(/"/g, '""');

  // Enclose the content with double quotes if it contains newlines, commas, or double quotes
  if (csvContent.includes('\n') || csvContent.includes(',') || csvContent.includes('"')) {
    csvContent = `"${csvContent}"`;
  }

  return csvContent;
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

async function exportLocalNewsToCSV(tableName) {
  const csvWriter = createCsvWriter({
    path: "localNews.csv",
    header: [
      {id: "id", title: "id"},
      {id: "type", title: "type"},
      {id: "neighborhood", title: "neighborhood"},
      {id: "category", title: "category"},
      {id: "author", title: "author"},
      {id: "date", title: "date"},
      {id: "title", title: "title"},
      {id: "subtitle", title: "subtitle"},
      {id: "content", title: "content"},
      {id: "url", title: "url"}
    ]
  });

  const jsonData = await convertToJSON(tableName);

  const newsData = jsonData
    .filter(item => item.attribute === 'type' && item.value === 'news')
    .map(item => ({id: item.object}));

  jsonData.forEach(item => {
    if (newsData.find(news => news.id === item.object)) {
      newsData.find(news => news.id === item.object)[item.attribute] = item.value;
    }
  });

  csvWriter.writeRecords(newsData)
    .then(() => console.log("Generated localNews.csv successfully!"))
    .catch(err => console.error("Error writing CSV for local news", err));

}

// To be used in future to convert content of local news to a more readable format
function convertCsvContentToReadableFormat(csvContent) {
  // Strip off the leading and trailing quote characters and curly braces
  let contentWithoutQuotes = csvContent.slice(2, -2);

  // Replace the sequence `","` with `<br><br>`
  let contentWithBreaks = contentWithoutQuotes.replace(/"",""/g, '<br><br>');

  // Replace the double double-quotes with single double-quotes
  let readableContent = contentWithBreaks.replace(/""/g, '"');

  return readableContent;
}

// const csvContent = `"{""A contentious meeting about the harbor brought out a bevy of boats but no board. District 2 Supervisor Catherine Stefani recused herself from representation because her husband owns a boat in the marina. The grassroots group “Keep The Waterfront Open” collected more than 2,500 signatures opposing plans that would remove boats located at Gashouse Cove — part of the Marina Small Craft Harbor since the 1960s — so that PG&E can “decontaminate the water.” Along with removal of the wooden slips and the only public fuel dock in town, the view of bobbing masts would be gone forever."",""Critics say the plan is really about the San Francisco Recreation and Park Department’s desire to accommodate much larger yachts, which would further restrict views from the Marina Green but would increase revenue flow to the agency, all while allowing PG&E to save millions by doing a less than adequate cleanup of its toxins under the water of the adjacent Gashouse Cove."",""With Stefani abstaining, the city charter says “the privilege of the floor shall not be granted, for any purpose, to persons other than officers of the City or their duly authorized representatives. This rule shall not be suspended except by unanimous consent of all Supervisors present,” which leaves residents without representation from their elected supervisor."",""At an Oct. 19 meeting, Rec and Park voted to move forward with an environmental impact review for the proposed plan, despite local opposition."}"`;

// let readableContent = convertCsvContentToReadableFormat(csvContent);

// console.log(readableContent);

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
// exportEventsToCSV(tableName)
// exportCafesToCSV(tableName)
