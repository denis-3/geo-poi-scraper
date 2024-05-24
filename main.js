const cheerio = require("cheerio");
require("dotenv").config();
const withDbClient = require("./dbClient");
const getGeoAttrId = require("./geo-attrs-map.js");
const puppeteer = require("puppeteer");
const uuid = require("uuid");
const fs = require("fs");

const OPA_API_URL = process.env.OPA_API_URL;

async function getPoisFromOverpass(poiType) {
	const initialQuery = await fetch(OPA_API_URL, {
		method: "POST",
		body: "data=" +
			encodeURIComponent(`
		[out:json]
		[timeout:90]
		[maxsize:1000000]
		;
		node(37.71044257039148,-122.52330780029298,37.80647004655113,-122.34684155555281)
		[amenity=${poiType}];
		out;`),
	});
	if (!initialQuery.ok) {
		const result = await initialQuery.text();
		return
	}
	const result = await initialQuery.json();
	return result.elements.filter((x) => x?.tags?.website !== undefined).slice(0, 10);
}

async function ddgPoiFetch(poiName) {
	const ddgDataFetch = await fetchWithTimeout(fetch("https://duckduckgo.com/local.js?l=us-en&q=" + encodeURIComponent(poiName + " san francisco")), 5000);
	const ddgData = await ddgDataFetch.json();
	if (ddgDataFetch.ok == false) {
		throw Error("Invalid status code");
	} else if (ddgData.signal !== "high") {
		throw Error("Signal was not high");
	}
	return ddgData.results[0];
}

async function getGenericAmenity(amenityType, tryYelpSearch = true) {
	const osmResults = await getPoisFromOverpass(amenityType)
	if (osmResults === undefined) {
		console.error("Error!!")
		return
	}
	const formattedResults = []

	for (var i = 0; i < osmResults.length; i++) {
		const e = osmResults[i]

		var businessDesc = undefined
		var businessImg = undefined
		var ddgData = {}
		var yelpDataText = "no text"
		var businessNeighborhood = ""
		const bizFeatures = []
		try {
			console.log("Getting information for business (", i, ")", e.tags.name)

			// get data from ddg widget
			ddgData = await ddgPoiFetch(e.tags.name)

			businessDesc = ddgData.embed?.description

			// get neighborhood of biz
			const geocodeUrl = `https://opencagedata.com/demo/proxy?url=${encodeURIComponent(`https://api.opencagedata.com/geocode/v1/json?q=${ddgData.address}&key=YOUR-API-KEY&language=en&pretty=1`)}&format=json`
			const geocodeFetch = await fetchWithTimeout(fetch(geocodeUrl), 7500)
			if (geocodeFetch.status == 200) {
				const geocodeJson = await geocodeFetch.json()
				businessNeighborhood = geocodeJson.results[0].components.neighbourhood ?? geocodeJson.results[0].components.suburb
			} else {
				console.log("Invalid geocoding status", geocodeFetch.status)
			}

			var bizYelpLink = ddgData.url;
			// search for business on yelp if needed (tripadvisor doesnt have business description)
			if (!bizYelpLink?.includes("yelp.com")) {
				const yelpSearchFetch = await fetchWithTimeout(
					fetch(`https://www.yelp.com/search?find_desc=${encodeURIComponent(e.tags.name)}&find_loc=&l=g%3A-122.3473745587771%2C37.873881200886444%2C-122.54787504705835%2C37.65050533338459`),
					7500
				)

				const yelpSearchText = await yelpSearchFetch.text()
				var yelpHtml = cheerio.load(yelpSearchText)
				bizYelpLink = "https://www.yelp.com" + yelpHtml("h3 > a").attr("href")
			} else {
				bizYelpLink = bizYelpLink.replace("http://", "https://www.")
			}

			// get business yelp page
			const yelpDataFetch = await fetchWithTimeout(fetch(bizYelpLink), 7500);
			yelpDataText = await yelpDataFetch.text();
			const yelpDataHtml = cheerio.load(yelpDataText);
			// extract and parse json in the yelp response which contains many useful biz properties
			const bizJsonData = JSON.parse(yelpDataHtml(`script[type=application/json]`).prop("textContent").slice(4, -3).replaceAll("&quot;", `"`))
			for (const key in bizJsonData) {
				if (key.includes("}).0.properties.")) {
					// properties of interest
					const propertyMaps = {
						"dogs_allowed": "Dogs Allowed",
						"wifi_options": "Has WiFi",
						"has_outdoor_seating": "Has outdoor seating",
						"RestaurantsTakeOut": "Offers takeout",
						"Caters": "Offers catering",
						"BusinessParking": "Has parking",
						"has_bike_parking": "Has Bike Parking"
					}
					if (Object.keys(propertyMaps).includes(bizJsonData[key].alias)) {
						bizFeatures.push([propertyMaps[bizJsonData[key].alias], bizJsonData[key].isActive])
					}
				}
			}

			// SEO meta tags are useful to get information
			const yelpPageTitle = normalizeBizName(yelpDataHtml("meta[property='og:title']").attr("content"));
			if (ddgData.url?.includes("yelp.com") || yelpPageTitle.includes(normalizeBizName(e.tags.name))) {
				businessDesc = yelpDataHtml("meta[property='og:description']").attr("content");
				businessImg = yelpDataHtml("meta[property='og:image']").attr("content");
			}
		} catch (err) {
			saveLog("error", `Generic amenity scrape for ${e.tags.name}`, yelpDataText)
			console.error("Failed getting business description from yelp, ", err);
		}

		const address = `${e.tags["addr:housenumber"] | e.tags["addr:number"]} ${e.tags["addr:street"]}`
		const dataObj = {
			type: amenityType,
			// type: "point of interest",
			website: e.tags.website,
			lattitude: e.lat,
			longitude: e.lon,
			name: e.tags.name,
			address: ddgData.address ?? address,
			hours: e.tags.opening_hours ?? e.tags["opening_hours:covid19"],
			description: businessDesc,
			image: businessImg ?? ddgData?.image ?? ddgData?.embed?.image,
			phoneNumber: ddgData.phoneNumber ?? e.tags.phone,
			avatar: ddgData?.embed?.icon,
			neighborhood: businessNeighborhood,
			_attrTypes: {
				type: "type",
				website: "url",
				lattitude: "float",
				longitude: "float",
				name: "string",
				address: "address",
				description: "string",
				phoneNumber: "phoneNumber",
				image: "image",
				avatar: "image",
				neighborhood: "string"
			},
			// stored just in case for reference later
			_allOsmResults: JSON.parse(JSON.stringify(e)),
		};

		bizFeatures.forEach(item => {
			dataObj[item[0]] = item[1]
			dataObj._attrTypes[item[0]] = "bool"
		})

		formattedResults.push(dataObj);
	}

	return formattedResults;
}

async function getCafeAmenities() {
	console.log("Starting getCafeAmenities...");
	const cafeResults = await getGenericAmenity("cafe");
	for (var _i = 0; _i < cafeResults.length; _i++) {
		const data = cafeResults[_i];
		data.type = "cafe";

		console.log("~~~Top Level Crawl", data.website);
		var menuUrl = undefined;
		var ddgData = {};

		try {
			data.website = toFetchUrl(data.website);
			let websiteContent = await fetchWithTimeout(fetch(data.website), 5000);
			let text = await websiteContent.text();
			const $ = cheerio.load(text);
			$("a").each((i, link) => {
				let href = $(link).attr("href");
				if (menuUrl === undefined && href?.includes("menu")) {
					console.log("found menu", href);
					if (href.startsWith("https://") || href.startsWith("http://") || href.startsWith("//")) {
						menuUrl = toFetchUrl(href);
					} else {
						menuUrl = toAbsoluteUrl(data.website, href);
					}
				}
			});

			ddgData = await ddgPoiFetch(data.name);
		} catch (e) {
			console.log("There was a error with POI", e);
		} finally {
			if (ddgData?.hours !== undefined /* && ddgData?.hours !== '' */ ) {
				delete ddgData.hours.closes_soon;
				delete ddgData.hours.is_open;
				delete ddgData.hours.opens_soon;
				delete ddgData.hours.state_switch_time;
				data.hours = JSON.stringify(ddgData.hours);
			}

			data.price = priceToNumber(ddgData.price);
			data.reviewsWebsite = ddgData.url;
			data.menuWebsite = menuUrl;
			data._attrTypes = {
				price: "int",
				reviewsWebsite: "url",
				amenities: "string",
				menuWebsite: "website",
			};
		}
	}
	return cafeResults;
}

// Function which gets events in San Francisco
async function getEvents(city = "san-francisco") {
	console.log("starting getEvents...");
	const encounteredEvents = [];
	const browser = await puppeteer.launch();

	// Meetup.com
	const meetupPageFetch = await fetchWithTimeout(fetch(`https://www.meetup.com/find/?eventType=inPerson&source=EVENTS&location=us--ca--${city}&distance=tenMiles`), 7500);
	const meetupPageText = await meetupPageFetch.text();
	const meetupPage = cheerio.load(meetupPageText);

	// eventbrite
	const eventbritePageFetch = await fetchWithTimeout(fetch(`https://www.eventbrite.com/d/ca--${city}/events--this-week/`), 7500);
	const eventbritePageText = await eventbritePageFetch.text();
	const eventbritePage = cheerio.load(eventbritePageText);

	const meetupLinks = [];
	meetupPage(`a[id="event-card-in-search-results"]`).each(function() {
		meetupLinks.push(meetupPage(this).attr("href"));
	});

	const eventbriteLinks = [];
	eventbritePage(`a[class="event-card-link "]`).each(function() {
		eventbriteLinks.push(eventbritePage(this).attr("href"));
	});

	let compiledEventLinks = [...eventbriteLinks, ...meetupLinks];

	let filteredEventLinks = [];
	compiledEventLinks.forEach((eventLink) => {
		if (!filteredEventLinks.includes(eventLink)) {
			filteredEventLinks.push(eventLink);
		}
	});

	console.log("filteredEventLinks: ", filteredEventLinks);

	const eventsPages = await browser.newPage();
	let meetupEventData = [];

	// For each link, navigate and extract relevant information
	for (const link of filteredEventLinks) {
		try {
			console.log("Navigating to:", link)

			const thisEventPageFetch = await fetchWithTimeout(fetch(link), 7500)
			const thisEventPageText = await thisEventPageFetch.text()
			const thisEventPage = cheerio.load(thisEventPageText)

			const extractedEventPageData = []
			thisEventPage('script[type="application/ld+json"]').each(function() {
				extractedEventPageData.push(JSON.parse(thisEventPage(this).prop("textContent")))
			})

			const price = thisEventPage(".conversion-bar__panel-info").prop("textContent")

			let relevantEventData
			const index = link.includes("https://www.eventbrite.com") ? 0 : 1
			relevantEventData = {
				type: "event",
				startDate: extractedEventPageData[index]?.startDate,
				endDate: extractedEventPageData[index]?.endDate,
				name: extractedEventPageData[index]?.name,
				url: extractedEventPageData[index]?.url,
				image: index == 0 ? extractedEventPageData[0]?.image : extractedEventPageData[1]?.image?.[0],
				description: extractedEventPageData[index]?.description,
				locationName: extractedEventPageData[index]?.location?.name,
				locationAddress: extractedEventPageData[index]?.location?.address?.streetAddress,
				organizerName: extractedEventPageData[index]?.organizer?.name,
				price: price,
				_attrTypes: {
					type: "type",
					startDate: "date",
					endDate: "date",
					name: "string",
					url: "url",
					image: "url-img",
					description: "string",
					locationName: "place",
					locationAddress: "address",
					organizerName: "organizer",
					price: "price"
				},
			};
			// concatenate some relevant paramaters to uniquely distinguish event
			const eventFingerprint = (relevantEventData.name + relevantEventData.organizerName + relevantEventData.startDate).toLowerCase();

			if (encounteredEvents.includes(eventFingerprint)) {
				continue;
			}

			encounteredEvents.push(eventFingerprint);
			// Revisit these console logs if I want to get more information
			// console.log("extractedEventPageData0: ", extractedEventPageData[0])
			// console.log("extractedEventPageData1: ", extractedEventPageData[1])
			// console.log("extractedEventPageData2: ", extractedEventPageData[2])
			meetupEventData.push(relevantEventData);
		} catch (error) {
			saveLog("error", `Event scrape for ${link}`, error)
			console.error(`Error navigating to ${link}:`, error);
		}
	}

	await browser.close();
	return meetupEventData;
}

async function getLocalNews(neighborhood) {
	neighborhood = neighborhood.toLowerCase()
	// sources
	const neighborhoodNews = {
		marina: {
			rootUrl: "https://www.marinatimes.com/category/news"
		},
		richmond: {
			rootUrl: "https://richmondsunsetnews.com/"
		},
		sunset: {
			rootUrl: "https://richmondsunsetnews.com/"
		},
		ingleside: {
			rootUrl: "https://www.inglesidelight.com/latest/"
		},
		mission: {
			rootUrl: "https://missionlocal.org/category/featured/"
		},
		chinatown: {
			rootUrl: "https://www.windnewspaper.com/category/chinatown"
		},
	};

	// selectors to get articles
	const linkSelectors = {
		marina: 'a[class="item container"]',
		ingleside: 'a[class="post-card__media"]',
		richmond: 'h2[class="posttitle"] > a',
		sunset: 'h2[class="posttitle"] > a',
		mission: 'a[class="post-thumbnail-inner"]',
	};

	const configs = {
		marina: {
			categorySelector: "div.category",
			authorSelector: "div.author",
			dateSelector: "div.date",
			titleSelector: "div.left > h1",
			subtitleSelector: "div.subtitle",
			contentSelector: ".content > p",
		},
		ingleside: {
			categorySelector: 'a[class*="post-tag mr-sm"]',
			authorSelector: "span.post-info__authors > a",
			dateSelector: "div.post-info > time",
			titleSelector: "h1.post-hero__title",
			subtitleSelector: "p.post-hero__excerpt.text-acc",
			contentSelector: 'article[class*="post-access-public"] > p',
		},
		richmond: {
			categorySelector: 'a[class="post-lead-category"]',
			// authorSelector: '',
			dateSelector: "time.entry-date",
			titleSelector: "h1.title",
			// subtitleSelector: '',
			contentSelector: 'section[class="entry"] > p',
		},
		sunset: {
			categorySelector: 'a[class="post-lead-category"]',
			// authorSelector: '',
			dateSelector: "time.entry-date",
			titleSelector: "h1.title",
			// subtitleSelector: '',
			contentSelector: 'section[class="entry"] > p',
		},
		mission: {
			categorySelector: 'span[class="cat-links"] > a',
			authorSelector: 'span[class="author vcard"] > a',
			dateSelector: 'time[class="entry-date published"]',
			titleSelector: "h1.entry-title ",
			// subtitleSelector: '',
			contentSelector: 'div[class="entry-content"] > p',
		},
	};

	const newsArticlesPageFetch = await fetchWithTimeout(fetch(neighborhoodNews[neighborhood].rootUrl), 7500)
	const newsArticlesPageText = await newsArticlesPageFetch.text()
	const newsArticlesPage = cheerio.load(newsArticlesPageText)

	const newsArticlesLinks = []
	newsArticlesPage(linkSelectors[neighborhood]).each(function () {
		newsArticlesLinks.push(newsArticlesPage(this).attr("href"))
	});

	const finalData = []

	for (const link of newsArticlesLinks) {
		const thisArticlePageFetch = await fetchWithTimeout(fetch(link), 7500)
		const thisArticlePageText = await thisArticlePageFetch.text()
		const thisArticlePage = cheerio.load(thisArticlePageText)

		const tConfig = configs[neighborhood]
		const extractedData = {
			type: "news",
			neighborhood: neighborhood,
			category: "" || thisArticlePage(tConfig.categorySelector).prop("textContent"),
			author: "" || thisArticlePage(tConfig.authorSelector).prop("textContent"),
			date: "" || thisArticlePage(tConfig.dateSelector).prop("textContent"),
			title: "" || thisArticlePage(tConfig.titleSelector).prop("textContent"),
			subtitle: "" || thisArticlePage(tConfig.subtitleSelector).prop("textContent"),
			url: link,
			_attrTypes: {
				type: "type",
				neighborhood: "string",
				category: "string",
				author: "string",
				date: "date",
				title: "string",
				subtitle: "string",
				content: "string",
				url: "string",
			},
		}
		for (const key in extractedData) {
			if (key.startsWith("_") || extractedData[key]?.trim == undefined) continue
			extractedData[key] = extractedData[key].trim()
			if (key == "author") {
				extractedData["author"] = extractedData["author"].replace("by ", "")
			} else if (key == "date") {
				console.log(extractedData["date"])
				extractedData["date"] = new Date(extractedData["date"])
			}
		}
		// console.log(extractedData)
		finalData.push(extractedData)
	}
	return finalData
}


// // Get Events by Local Neighborhood, this finds neighborhood-specific outlets
// async function getLocalEvents(neighborhood) {
// 	console.log("starting getLocalEvents...");
// 	const browser = await puppeteer.launch();
//
// 	if (neighborhood.toLowerCase() === "inner sunset") {
// 		const sunsetNewsPage = await browser.newPage();
// 		await sunsetNewsPage.goto(`https://www.inner-sunset.org/events-2/`, {
// 			waitUntil: "networkidle2",
// 		});
// 	} else if (neighborhood.toLowerCase() === "cole valley") {
// 		const coleValleyNewsPage = await browser.newPage();
// 		await coleValleyNewsPage.goto(`http://www.colevalleysf.com/local-happenings.html`, {
// 			waitUntil: "networkidle2",
// 		});
// 	} else if (neighborhood.toLowerCase() === "nopa") {
// 		const nopaNewsPage = await browser.newPage();
// 		await nopaNewsPage.goto(`https://www.nopna.org/events`, {
// 			waitUntil: "networkidle2",
// 		});
// 	}
// }

async function main() {
	// targeted amenities for scraping
	// this is just a start, more can be added
	const targetAmenities = ["car_rental", "fast_food", "restaurant", "library", "fuel", "bank", "cinema"]
	const neighborhoods = ["marina", "ingleside", "mission", "richmond", "sunset"]

	const finalResults = []

	for (neighborhood in neighborhoods) {
		const neighborhoodNews = await getLocalNews(neighborhoods[neighborhood])
		finalResults.push(...neighborhoodNews)
	}

	const cafeResults = await getCafeAmenities()
	finalResults.push(...cafeResults)

	const eventResults = await getEvents();
	finalResults.push(...eventResults)

	// get other amenities (it takes a bit)
	for (var i = 0; i < targetAmenities.length; i++) {
		const genResults = await getGenericAmenity(targetAmenities[i]);
		finalResults.push(...genResults);
	}

	// console.log(finalResults);

	// convert final results to geo mappings
	finalResults.forEach((elm) => {
		for (const key in elm) {
			const tmp = elm[key];
			delete elm[key];
			elm[getGeoAttrId(key)] = tmp;
		}
	});

	// data can be just pushed to remote, or synced with it
	withDbClient(async (dbConfig) => {
		// await syncWithRemote(finalResults, dbConfig, true)

		for (let i = 0; i < finalResults.length; i++) {
			const cleaned = cleanObjectForDb(finalResults[i])
			await saveToPostgres(cleaned, dbConfig);
		}
	});
}

main();

function toFetchUrl(url) {
	if (url.startsWith("//") || (url.startsWith("http://") == false && url.startsWith("https://") == false)) {
		url = "http:" + url;
	}

	if (url.endsWith("/")) {
		url = url.slice(0, -1);
	}

	return url;
}

function toAbsoluteUrl(base, relative) {
	base = toFetchUrl(base);
	if (!base.endsWith("/") && !relative.startsWith("/")) {
		base += "/";
	}
	return base + relative;
}

function fetchWithTimeout(fetchReq, timeout) {
	return Promise.race([
		fetchReq,
		new Promise((resolve, reject) => {
			setTimeout(() => reject(`Fetch timeout reached: ${timeout}ms`), timeout);
		}),
	]);
}

function priceToNumber(priceVal) {
	if (isNaN(priceVal) == false) {
		return Number(priceVal);
	}
	priceVal = String(priceVal).toLowerCase();

	if (priceVal == "undefined") {
		return undefined;
	} else if (priceVal == "cheap") {
		return 0;
	} else if (priceVal == "moderate") {
		return 1;
	} else {
		throw Error("Unknown price " + priceVal);
	}
}

// try to eliminate some common variations in business naming
function normalizeBizName(str) {
	return str.toLowerCase().replaceAll("&", "and").replaceAll("-", " ");
}

// remove undefined, null, and 0 length values
function cleanObjectForDb(obj) {
	for (const key in obj) {
		if (obj[key] === undefined || obj[key] === null || obj[key]?.length == 0) {
			delete obj[key]
		}
	}
	return obj
}

// some log of a scrape that was made
// title, status, body can be anything
function saveLog(logStatus, logTitle, mainLogBody) {
	fs.writeFileSync(`./logs/${Date.now()}.txt`, `STATUS: ${logStatus}\nTITLE: ${logTitle}\nTIME: ${String(new Date())}\nMAIN CONTENT:\n${mainLogBody}`)
}

// save object as OAV triplets to postgres
async function saveToPostgres(dataObj, client) {
	if (typeof dataObj._attrTypes !== "object" || dataObj._attrTypes === null) {
		throw Error("Must have _attrTypes key as an object");
	}
	// Clone the attrTypes and remove from dataObj
	const attrTypes = JSON.parse(JSON.stringify(dataObj._attrTypes));
	delete dataObj._attrTypes;

	// Generate a random ID for the object
	const randomId = uuid.v4();

	for (const [key, value] of Object.entries(dataObj)) {
		if (!key.startsWith("_")) {
			const queryStr = "INSERT INTO poiData(object, attribute, value, attributeType) VALUES($1, $2, $3, $4)";
			await client.query(queryStr, [randomId, key, value, attrTypes[key]]);
		}
	}
}

async function syncWithRemote(dataObj, client, saveToCsv = false) {
	// dataObj = JSON.parse(JSON.stringify(dataObj));
	const remoteClientCall = await client.query("SELECT * FROM poiData");
	const remoteData = {};
	remoteClientCall.rows.forEach((row) => {
		if (remoteData[row.object] === undefined) {
			remoteData[row.object] = {};
		}
		remoteData[row.object][row.attribute] = row.value;
	});

	// mapping from these random uuid's in memory to uuid's in remote
	const thisToRemoteKey = {};

	// event processing will come later...
	for (const tKey in dataObj) {
		if (dataObj[tKey].type == "event") {
			delete dataObj[tKey];
			continue;
		}

		// make unique fingerprint for each poi based on poidata
		const thisObjPrint = dataObj[tKey].name + dataObj[tKey].lattitude + dataObj[tKey].longitude;
		for (const rKey in remoteData) {
			const remoteObjPrint = remoteData[rKey].name + remoteData[rKey].lattitude + remoteData[rKey].longitude;
			if (remoteObjPrint == thisObjPrint) {
				thisToRemoteKey[tKey] = rKey;
				// see what data differs between local and remote
				for (const propKey in dataObj[tKey]) {
					const tProperty = typeof dataObj[tKey][propKey] == "object" ? JSON.stringify(dataObj[tKey][propKey]) : String(dataObj[tKey][propKey]);

					const rProperty = typeof remoteData[rKey][propKey] == "object" ? JSON.stringify(remoteData[rKey][propKey]) : String(remoteData[rKey][propKey]);

					// if the two relevant keys are the same then remove them from net changes
					if (tProperty === rProperty || (tProperty == "null" && rProperty == "undefined")) {
						delete dataObj[tKey][propKey];
					}
				}
			}
		}
	}

	console.log("data obj is", dataObj);
	if (saveToCsv) {
		fs.writeFileSync("./changes-export.csv", "object,attribute,value\n");
		for (var i = 0; i < dataObj.length; i++) {
			for (const key in dataObj[i]) {
				// don't update underscore'd keys
				if (key.startsWith("_")) continue;
				fs.appendFileSync("./changes-export.csv", `"${thisToRemoteKey[i]}","${key}","${dataObj[i][key]}"\n`);
			}
		}
		return
	}

	for (var i = 0; i < dataObj.length; i++) {
		if (JSON.stringify(dataObj[i]) == "{}") continue;
		for (const key in dataObj[i]) {
			// don't update underscore'd keys
			if (key.startsWith("_") || dataObj[i][key] == undefined || dataObj[i][key] == null) continue;

			const queryStr = "UPDATE poiData SET value = $1 WHERE object = $2 AND attribute = $3";
			const result = await client.query(queryStr, [dataObj[i][key], thisToRemoteKey[i], key]);
			if (result.rowCount == 0) {
				const newQueryStr = "INSERT INTO poiData(object, attribute, value, attributeType) VALUES($1, $2, $3, $4)";
				await client.query(newQueryStr, [thisToRemoteKey[i], key, dataObj[i][key], dataObj[i]._attrTypes[key]]);
			}
		}
	}
}
