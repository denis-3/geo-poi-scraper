const cheerio = require('cheerio');
const OPA_API_URL = "https://overpass-api.de/api/interpreter"

const Postgres = require("pg")
const client = new Postgres.Client({
	user: "postgres",
	host: "localhost",
	password: "cool",
	port: 5432,
	database: "postgres"
})

async function getCafeAmenities() {
    const filtered = await getPoisFromOverpass("cafe")
		if (filtered === undefined) {
			console.error("Error!!")
			return
		}
    const formattedResults = []
    for (let e of filtered) {
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

						// search for business on yelp
						const yelpSearchFetch = await fetchWithTimeout(fetch(`
							https://www.yelp.com/search?find_desc=${encodeURIComponent(e.tags.name)}&find_loc=&l=g%3A-122.3473745587771%2C37.873881200886444%2C-122.54787504705835%2C37.65050533338459
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
        } catch(e) {
            console.log("There was a error with POI", e)
        } finally {
					if (ddgData?.hours !== undefined) {
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
							hours: ddgData.hours,
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
	finalResults.push(...cafeResults, ...genResults)


	console.log(finalResults)

	// save results
	await client.connect()

	for (var i = 0; i < finalResults.length; i++) {
		await saveToPostgres(finalResults[i])
	}

	await client.end()
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
			node(37.71044257039148,-122.52330780029298,37.80647004655113,-122.34684155555281)[amenity=${poiType}];
			out;`)
	})
	if (!initialQuery.ok) {
			const result = await initialQuery.text()
			console.log(result)
			return
	}
	const result = await initialQuery.json()
	return result.elements.filter(x => x?.tags?.website !== undefined).slice(0, 10)
}

async function ddgPoiFetch(poiName) {
	const ddgDataFetch = await fetchWithTimeout(fetch("https://duckduckgo.com/local.js?l=us-en&q=" + encodeURIComponent(poiName + " san francisco")), 5000)
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
			await client.query(queryStr)
		}
	}
}
