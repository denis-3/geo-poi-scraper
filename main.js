const cheerio = require('cheerio');
require('dotenv').config()
const Postgres = require("pg")

const OPA_API_URL = process.env.OPA_API_URL

const dbConfig = new Postgres.Client({
	user: process.env.CLIENT_USER,
	host: process.env.CLIENT_HOST,
	password: process.env.CLIENT_PASSWORD,
	port: process.env.CLIENT_PORT,
	database: process.env.CLIENT_DB
})

async function getCafeAmenities() {
	console.log("Starting getCafeAmenities...");
    const filtered = await getPoisFromOverpass("cafe")
	console.log("Filtered results:", filtered);
	if (filtered === undefined) {
		console.error("Error!!")
		return
	}
    const formattedResults = []
    for (let e of filtered) {
		// console.log("each element: ", e)
        e.tags.website = toFetchUrl(e.tags.website)

        console.log("~~~Top Level Crawl~~~", e.tags.website)
        var menuUrl = undefined
		var ddgData = {}
		var yelpData = []
        try {
            let websiteContent = await fetchWithTimeout(fetch(e.tags.website), 5000);
            let text = await websiteContent.text();
            const $ = cheerio.load(text);
            $('a').each((i, link) => {
                let href = $(link).attr('href');
                if (menuUrl === undefined && href?.includes("menu")) {
                    console.log("found menu", href)
                    if (href.startsWith("https://") || href.startsWith("http://") || href.startsWith("//")) {
                        menuUrl = toFetchUrl(href)
                    } else {
                        menuUrl = toAbsoluteUrl(e.tags.website, href)
                    }
                }
            });

			ddgData = await ddgPoiFetch(e.tags.name)

			// TODO: Figure out what to do for Yelp rate limits (500 API calls per 24 hours) — more info at https://docs.developer.yelp.com/docs/fusion-rate-limiting
			// ^ They mention caching as a potential method to minimize API calls, could also contact them to get more calls

			// search for business on yelp
			const yelpSearchFetch = await fetchWithTimeout(fetch(`
				https://www.yelp.com/search?find_desc=${encodeURIComponent(e.tags.name)}&find_loc=&l=g%3A-122.3473745587771%2C37.873881200886444%2C-122.54787504705835%2C37.65050533338459
			`), 7500)
			// console.log("yelpSearchFetch: ", yelpSearchFetch)
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
        } catch(e) {
            console.log("There was a error with POI", e)
        } finally {
			// console.log("ddgData?.hours: ", ddgData?.hours)
			// TODO: Need to add another conditional statement for when hours is empty, currently we skip it entirely
			// An idea would be to actually look at each element pulled from Overpass API and analyze the opening_hours method 
			// ^ (most places seem to work, with some caveats and formatting adjustments needed)

			// Another observation, some sites (ex: https://noecafe.com/) seemingly have hours as an empty string because
			// the website is a parent website of multiple locations. This poses an edge case and needs a workaround.
			if (ddgData?.hours !== undefined /* && ddgData?.hours !== '' */) {
				delete ddgData.hours.closes_soon
				delete ddgData.hours.is_open
				delete ddgData.hours.opens_soon
				delete ddgData.hours.state_switch_time
				ddgData.hours.monday = ddgData.hours.Mon
				ddgData.hours.tuesday = ddgData.hours.Tue
				ddgData.hours.wednsday = ddgData.hours.Wed
				ddgData.hours.thursday = ddgData.hours.Thu
				ddgData.hours.friday = ddgData.hours.Fri
				ddgData.hours.saturday = ddgData.hours.Sat
				ddgData.hours.sunday = ddgData.hours.Sun
			}
			if (JSON.stringify(ddgData).length <= 15) {
				delete ddgData.hours
			}
			const dataObj = {
				type: "cafe",
				website: e.tags.website,
				menuWebsite: menuUrl,
				lattitude: e.lat,
				longitude: e.lon,
				name: e.tags.name,
				address: ddgData?.address || `${e.tags["addr:housenumber"] | e.tags["addr:number"]} ${e.tags["addr:street"]}`,
				price: priceToNumber(ddgData.price),
				hours: JSON.stringify(ddgData.hours),
				reviewsWebsite: ddgData.url,
				phoneNumber: ddgData.phone,
				amenities: yelpData.length == 0 ? undefined : yelpData
			}
			formattedResults.push(dataObj)
		}
    }
	return formattedResults
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
			type: amenityType,
			website: e.tags.website,
			lattitude: e.lat,
			longitude: e.lon,
			name: e.tags.name,
			address: ddgData?.address || `${e.tags["addr:housenumber"] | e.tags["addr:number"]} ${e.tags["addr:street"]}`,
			reviewsWebsite: ddgData.url,
			phoneNumber: ddgData.phone,
		}
		formattedResults.push(dataObj)
	}

	return formattedResults
}


async function main() {
	const finalResults = []

	const cafeResults = await getCafeAmenities()
	const genResults = await getGenericAmenity("car_rental")

	// Question: Why are only some results showing? Should be more...
	finalResults.push(...cafeResults, ...genResults)


	console.log(finalResults)

	// save results
	await dbConfig.connect()

	for (var i = 0; i < finalResults.length; i++) {
		await saveToPostgres(finalResults[i])
	}

	await dbConfig.end()
}

main()
  
function toFetchUrl(url) {
    if (url.startsWith("//")) {
        url = url.slice(2, url.length)
    }

    if (url.startsWith("http://") == false &&
        url.startsWith("https://") == false) {
        url = "http://" + url
    }

    if (url.endsWith("/")) {
        url = url.slice(0, -1)
    }

    return url
}

function toAbsoluteUrl(base, relative) {
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
		out;`
		)
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
		fetch("https://duckduckgo.com/local.js?l=us-en&q=" + encodeURIComponent(poiName + " san francisco"))
	, 5000)
	const ddgData = await ddgDataFetch.json()
	if (ddgDataFetch.ok == false) {
		throw Error("Invalid status code")
	} else if (ddgData.signal !== "high") {
		throw Error("Signal was not high")
	}
	return ddgData.results[0]
}

// save object as OAV triplets to postgres
async function saveToPostgres(dataObj) {
	const randomId = String(Math.random()).slice(3)

	for (var key in dataObj) {
		if (String(dataObj[key]) !== "undefined" && String(dataObj[key]) !== "null") {
			// quote escaping
			if (typeof dataObj[key] == "string" && dataObj[key].includes("'")) {
				dataObj[key] = dataObj[key].replace("'", "''")
			}
			const queryStr = `INSERT INTO poiData(object, attribute, value) VALUES ('${randomId}', '${key}', '${dataObj[key]}')`
			await dbConfig.query(queryStr)
		}
	}
}
