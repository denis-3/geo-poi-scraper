const cheerio = require('cheerio');
require('dotenv').config()
const withDbClient = require('./dbClient');
const puppeteer = require('puppeteer');
const uuid = require("uuid")

const OPA_API_URL = process.env.OPA_API_URL

async function getCafeAmenities() {
	console.log("Starting getCafeAmenities...");
	const cafeResults = await getGenericAmenity("cafe")
	// console.log("Initial results:", cafeResults);
	for (var _i = 0; _i < cafeResults.length; _i++) {
		const data = cafeResults[_i]
		data.type = "cafe"

		console.log("~~~Top Level Crawl", data.website)
		var menuUrl = undefined
		var ddgData = {}
		var yelpData = []

		try {
			data.website = toFetchUrl(data.website)
			let websiteContent = await fetchWithTimeout(fetch(data.website), 5000);
			let text = await websiteContent.text();
			const $ = cheerio.load(text);
			$('a').each((i, link) => {
				let href = $(link).attr('href');
				if (menuUrl === undefined && href?.includes("menu")) {
					console.log("found menu", href)
					if (href.startsWith("https://") || href.startsWith("http://") || href.startsWith("//")) {
						menuUrl = toFetchUrl(href)
					} else {
						menuUrl = toAbsoluteUrl(data.website, href)
					}
				}
			});

			ddgData = await ddgPoiFetch(data.name)

			// TODO: Figure out what to do for Yelp rate limits (500 API calls per 24 hours) — more info at https://docs.developer.yelp.com/docs/fusion-rate-limiting
			// ^ They mention caching as a potential method to minimize API calls, could also contact them to get more calls

			// search for business on yelp
			const yelpSearchFetch = await fetchWithTimeout(fetch(`
				https://www.yelp.com/search?find_desc=${encodeURIComponent(data.name)}&find_loc=&l=g%3A-122.3473745587771%2C37.873881200886444%2C-122.54787504705835%2C37.65050533338459
			`), 7500)

			const yelpSearchText = await yelpSearchFetch.text()
			var yelpHtml = cheerio.load(yelpSearchText)
			const bizYelpLink = yelpHtml("span.css-1egxyvc a").attr("href")

			// get business yelp page
			const yelpDataFetch = await fetchWithTimeout(fetch(`https://www.yelp.com${bizYelpLink}`), 7500)
			var yelpDataText = await yelpDataFetch.text()
			yelpDataText = yelpDataText.replaceAll("&quot;", "\"")
			yelpDataText = yelpDataText.substring(yelpDataText.indexOf("organizedProperties.0.properties"), yelpDataText.lastIndexOf("organizedProperties.0.properties"))
			const attributesRegexp = new RegExp("\"displayText\":\".{0,50}?\"", "g")

			// add all the amenities to the yelp data
			yelpDataText.match(attributesRegexp).forEach(str => {
				yelpData.push(
					str.replace(`"displayText":"`, "").replace(`"`, "")
				)
			});
			yelpData = yelpData.filter(x => x != "Women-owned" && !x.includes("noise"))
		} catch (e) {
			console.log("There was a error with POI", e)
		} finally {
			// console.log("ddgData?.hours: ", ddgData?.hours)
			// TODO: Need to add another conditional statement for when hours is empty, currently we skip it entirely
			// An idea would be to actually look at each element pulled from Overpass API and analyze the opening_hours method
			// ^ (most places seem to work, with some caveats and formatting adjustments needed)

			// Another observation, some sites (ex: https://noecafe.com/) seemingly have hours as an empty string because
			// the website is a parent website of multiple locations. This poses an edge case and needs a workaround.
			if (ddgData?.hours !== undefined /* && ddgData?.hours !== '' */ ) {
				delete ddgData.hours.closes_soon
				delete ddgData.hours.is_open
				delete ddgData.hours.opens_soon
				delete ddgData.hours.state_switch_time
				// is name change neded?
				// ddgData.hours.monday = ddgData.hours.Mon
				// ddgData.hours.tuesday = ddgData.hours.Tue
				// ddgData.hours.wednsday = ddgData.hours.Wed
				// ddgData.hours.thursday = ddgData.hours.Thu
				// ddgData.hours.friday = ddgData.hours.Fri
				// ddgData.hours.saturday = ddgData.hours.Sat
				// ddgData.hours.sunday = ddgData.hours.Sun

				data.hours = JSON.stringify(ddgData.hours)
			} else if (data?._allOsmResults?.tags?.opening_hours != undefined) {
				data.hours = data._allOsmResults.tags.opening_hours
			}

			data.address =  ddgData?.address
			data.price = priceToNumber(ddgData.price)
			data.reviewsWebsite = ddgData.url
			data.amenities = yelpData.length == 0 ? undefined : yelpData
			data.phoneNumber = ddgData.phone
			data._attrTypes.price = "int"
			data._attrTypes.reviewsWebsite = "url"
			data._attrTypes.amenities = "string"
			data._attrTypes.phoneNumber = "phoneNumber"
		}
	}
	return cafeResults
}

async function getGenericAmenity(amenityType) {
	const osmResults = await getPoisFromOverpass(amenityType)
	if (osmResults === undefined) {
		console.error("Error!!")
		return
	}
	const formattedResults = []

	for (var _i = 0; _i < osmResults.length; _i++) {
		const e = osmResults[_i]

		const ddgData = await ddgPoiFetch(e.tags.name)

		const dataObj = {
			// type: amenityType,
			type: "point of interest",
			website: e.tags.website,
			lattitude: e.lat,
			longitude: e.lon,
			name: e.tags.name,
			address: `${e.tags["addr:housenumber"] | e.tags["addr:number"]} ${e.tags["addr:street"]}`,
			_attrTypes: {
				type: "type",
				website: "url",
				lattitude: "float",
				longitude: "float",
				name: "string",
				address: "address",
			},
			// stored just in case for reference later
			_allOsmResults: JSON.parse(JSON.stringify(e))
		}
		formattedResults.push(dataObj)
	}

	return formattedResults
}

// Function which gets events in San Francisco
async function getEvents(city = "san-francisco") {
	console.log("starting getEvents...");
	const encounteredEvents = []
	const browser = await puppeteer.launch();

	// Meetup.com
	const meetupPage = await browser.newPage();
	await meetupPage.goto(`https://www.meetup.com/find/?eventType=inPerson&source=EVENTS&location=us--ca--${city}&distance=tenMiles`, {
		waitUntil: 'networkidle2'
	});

	// Eventbrite
	const eventbritePage = await browser.newPage();
	await eventbritePage.goto(`https://www.eventbrite.com/d/ca--${city}/events--this-week/`,
		{ waitUntil: 'networkidle2' }
	)

	const eventBriteLinks = await eventbritePage.evaluate(
		() => Array.from(
			document.querySelectorAll('a[class="event-card-link "]'),
			a => a.getAttribute('href')
		)
	);

	const meetupLinks = await meetupPage.evaluate(
		() => Array.from(
			document.querySelectorAll('a[id="event-card-in-search-results"]'),
			a => a.getAttribute('href')
		)
	);

	let compiledEventLinks = [...eventBriteLinks, ...meetupLinks]

	let filteredEventLinks = [];
	compiledEventLinks.forEach((eventLink) => {
		if (!(filteredEventLinks.includes(eventLink))) {
			filteredEventLinks.push(eventLink)
		}
	})

	console.log("filteredEventLinks: ", filteredEventLinks);

	const eventsPages = await browser.newPage();
	let meetupEventData = [];

	// For each link, navigate and extract relevant information
	for (const link of filteredEventLinks) {
		try {
			console.log("Navigating to:", link);

			await eventsPages.goto(link, {
				waitUntil: "networkidle0",
				timeout: 30000
			});

			const extractedEventPageData = await eventsPages.evaluate(() => {
				const jsonScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
				return jsonScripts.map(script => JSON.parse(script.textContent));
			});

			let relevantEventData;
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
					organizerName: "project",
				}
			}
			// concatenate some relevant paramaters to uniquely distinguish event
			const eventFingerprint = (relevantEventData.name +
				relevantEventData.organizerName +
				relevantEventData.startDate).toLowerCase()

			if (encounteredEvents.includes(eventFingerprint)) {
				continue;
			}

			encounteredEvents.push(eventFingerprint)
			// Revisit these console logs if I want to get more information
			// console.log("extractedEventPageData0: ", extractedEventPageData[0])
			// console.log("extractedEventPageData1: ", extractedEventPageData[1])
			// console.log("extractedEventPageData2: ", extractedEventPageData[2])
			meetupEventData.push(relevantEventData)
		} catch (error) {
			console.error(`Error navigating to ${link}:`, error);
		}
	}

	console.log("meetupEventData: ", meetupEventData)

	await browser.close();
	return meetupEventData
}

// getEvents()

// Local news function by neighborhood
async function getLocalNews(neighborhood) {
	console.log("starting getLocalNews...");
	const browser = await puppeteer.launch();

	// See https://www.reddit.com/r/AskSF/comments/16busau/new_to_sf_best_local_newspapers/ for inspiration
	// Add News outlets? Might not be the right place if the goal is to do local news by neighborhood, although it is possible
	// ABC7 News San Francisco
	// SFist
	// Hoodline

	const neighborhoodNews = {
		"marina": {
			rootUrl: "https://www.marinatimes.com/category/news",
		},
		"richmond": {
			rootUrl: "https://richmondsunsetnews.com/"
		},
		"sunset": {
			rootUrl: "https://richmondsunsetnews.com/"
		},
		"ingleside": {
			rootUrl: "https://www.inglesidelight.com/latest/"
		}, 
		"mission": {
			rootUrl: "https://missionlocal.org/category/featured/"
		},
		"chinatown": {
			rootUrl: "https://www.windnewspaper.com/category/chinatown"
		}
	}

	const newsPage = await browser.newPage();
	await newsPage.goto(neighborhoodNews[neighborhood.toLowerCase()].rootUrl, {
		waitUntil: 'networkidle2'
	})

	const newsLinks = await newsPage.evaluate(
		(neighborhood) => {
			const linkSelectors = {
				"marina": 'a[class="item container"]',
				"ingleside": 'a[class="post-card__media"]',
				"richmond": 'h2[class="posttitle"] > a',
				"sunset": 'h2[class="posttitle"] > a',
				"mission": 'a[class="post-thumbnail-inner"]'
			};
			const selector = linkSelectors[neighborhood.toLowerCase()] 
			return Array.from(
				document.querySelectorAll(selector),
				a => a.getAttribute('href')
			);
		},
		neighborhood 
	);

	console.log("newsLinks: ", newsLinks)

	const newsPages = await browser.newPage();
	let newsData = [];

	for (const link of newsLinks) {
		try {
			console.log("Navigating to:", link);

			await newsPages.goto(link, {
				waitUntil: "networkidle0",
				timeout: 60000
			});

			// Leave this here for testing
			/* const extractedEventPageData = await newsPages.evaluate((neighborhood) => {
				console.log(" in extractedEventPageData")
				let newsArticleObj = {}
				newsArticleObj['category'] = '' || document.querySelector('a[class="post-lead-category"]').innerText;
				newsArticleObj['author'] = '' || document.querySelector('').innerText;
				newsArticleObj['date'] = '' || document.querySelector('time.entry-date').innerText;
				newsArticleObj['title'] = '' || document.querySelector('h1.title').innerText;
				newsArticleObj['subtitle'] = '' || document.querySelector('p.post-hero__excerpt.text-acc').innerText;
				newsArticleObj['content'] = '' || Array.from(document.querySelectorAll('section[class="entry"] > p')).map(p => p.innerText);
				return newsArticleObj;
			}, neighborhood);

			console.log("extractedEventPageData: ", extractedEventPageData) */

			const extractedEventPageData = await newsPages.evaluate((neighborhood, link) => {
				console.log(" in extractedEventPageData")
				const configs = {
					"marina": {
						categorySelector: 'div.category',
						authorSelector: 'div.author',
						dateSelector: 'div.date',
						titleSelector: 'div.left > h1',
						subtitleSelector: 'div.subtitle',
						contentSelector: '.content > p'
					},
					"ingleside": {
						categorySelector: 'a[class*="post-tag mr-sm"]',
						authorSelector: 'span.post-info__authors > a',
						dateSelector: 'div.post-info > time',
						titleSelector: 'h1.post-hero__title',
						subtitleSelector: 'p.post-hero__excerpt.text-acc',
						contentSelector: 'article[class*="post-access-public"] > p'
					},
					"richmond": {
						categorySelector: 'a[class="post-lead-category"]',
						// authorSelector: '',
						dateSelector: 'time.entry-date',
						titleSelector: 'h1.title',
						// subtitleSelector: '',
						contentSelector: 'section[class="entry"] > p'
					},
					"sunset": {
						categorySelector: 'a[class="post-lead-category"]',
						// authorSelector: '',
						dateSelector: 'time.entry-date',
						titleSelector: 'h1.title',
						// subtitleSelector: '',
						contentSelector: 'section[class="entry"] > p'
					},
					"mission": {
						categorySelector: 'span[class="cat-links"] > a',
						authorSelector: 'span[class="author vcard"] > a',
						dateSelector: 'time[class="entry-date published"]',
						titleSelector: 'h1.entry-title ',
						// subtitleSelector: '',
						contentSelector: 'div[class="entry-content"] > p'
					}
				};

				const config = configs[neighborhood.toLowerCase()];

				let newsArticleObj = {
					type: 'news',
					neighborhood: neighborhood,
					category: '' || document.querySelector(config.categorySelector)?.innerText,
					author: '' || document.querySelector(config.authorSelector)?.innerText,
					date: '' || document.querySelector(config.dateSelector)?.innerText,
					title: '' || document.querySelector(config.titleSelector)?.innerText,
					subtitle: '' || document.querySelector(config.subtitleSelector)?.innerText,
					content: '' || Array.from(document.querySelectorAll(config.contentSelector))
						.map(p => p.innerText)
  						.join('<br><br>'),
					url: link,
					_attrTypes: {
						type: "type",
						neighborhood: "string",
						category: "string",
						author: "string",
						date: "date",
						title: "string",
						subtitle: "string",
						content: "content",
						url: "string",
					}
				}
				return newsArticleObj;
			}, neighborhood, link);
			newsData.push(extractedEventPageData)
		} catch (error) {
			console.error(`Error navigating to ${link}:`, error);
		}
	}
	await browser.close();
	return newsData
}

// getLocalNews("mission")

async function main() {
	// targeted amenities for generic scraping
	// this is just a start, more can be added
	const targetAmenities = [
		"car_rental",
		"fast_food",
		"restaurant",
		"library",
		"fuel",
		"bank",
	]
	const finalResults = []

	const neighborhoods = ["marina", "ingleside", "mission", "richmond", "sunset"]

	let neighborhoodNews;
	for (neighborhood in neighborhoods) {
		neighborhoodNews = await getLocalNews(neighborhoods[neighborhood])
		finalResults.push(...neighborhoodNews)
	}

	console.log("finalResults: ", finalResults)

	const cafeResults = await getCafeAmenities()
	const eventResults = await getEvents()

	finalResults.push(...cafeResults, ...eventResults)

	// get generic amenities (it takes a bit)
	// for (var i = 0; i < targetAmenities.length; i++) {
	// 	const genResults = await getGenericAmenity(targetAmenities)
	// 	finalResults.push(...genResults)
	// }

	console.log(finalResults)

	withDbClient(async (dbConfig) => {
		for (let i = 0; i < finalResults.length; i++) {
			await saveToPostgres(finalResults[i], dbConfig);
		}
	});
}

main()

function toFetchUrl(url) {
	if (url.startsWith("//") ||
	(url.startsWith("http://") == false &&
	url.startsWith("https://") == false) ) {

		url = "http:" + url
	}

	if (url.endsWith("/")) {
		url = url.slice(0, -1)
	}

	return url
}

function toAbsoluteUrl(base, relative) {
	base = toFetchUrl(base)
	if (!base.endsWith("/") && !relative.startsWith("/")) {
		base += "/"
	}
	return base + relative;
}

function fetchWithTimeout(fetchReq, timeout) {
	return Promise.race([
		fetchReq,
		new Promise((resolve, reject) => {
			setTimeout(() => reject(`Fetch timeout reached: ${timeout}ms`), timeout)
		})
	])
}

function priceToNumber(priceVal) {
	if (isNaN(priceVal) == false) {
		return Number(priceVal)
	}
	priceVal = String(priceVal).toLowerCase()

	if (priceVal == "undefined") {
		return undefined
	} else if (priceVal == "cheap") {
		return 0
	} else if (priceVal == "moderate") {
		return 1
	} else {
		throw Error("Unknown price " + priceVal)
	}
}

async function getPoisFromOverpass(poiType) {
	const initialQuery = await fetch(OPA_API_URL, {
		method: "POST",
		body: "data=" + encodeURIComponent(`
		[out:json]
		[timeout:90]
		[maxsize:1000000]
		;
		node(37.71044257039148,-122.52330780029298,37.80647004655113,-122.34684155555281)
		[amenity=${poiType}];
		out;`)
	})
	if (!initialQuery.ok) {
		const result = await initialQuery.text()
		return;
	}
	const result = await initialQuery.json()
	return result.elements.filter(x => x?.tags?.website !== undefined).slice(0, 10)
}

async function ddgPoiFetch(poiName) {
	const ddgDataFetch = await fetchWithTimeout(
		fetch("https://duckduckgo.com/local.js?l=us-en&q=" + encodeURIComponent(poiName + " san francisco")), 5000)
	const ddgData = await ddgDataFetch.json()
	if (ddgDataFetch.ok == false) {
		throw Error("Invalid status code")
	} else if (ddgData.signal !== "high") {
		throw Error("Signal was not high")
	}
	return ddgData.results[0]
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
	  if (!key.startsWith("_") && String(value) !== "undefined" && String(value) !== "null") {
		const queryStr = "INSERT INTO poiData(object, attribute, value, attributeType) VALUES($1, $2, $3, $4)";
		await client.query(queryStr, [randomId, key, value, attrTypes[key]]);
	  }
	}
  }
