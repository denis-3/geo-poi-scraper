# Local Business Scraper

This is a web scraper which compiles data from various soures (Yelp, DuckDuckGo search widget, Open Street Maps API, and more) to make a comprehensive and structured entry of local businesses in San Francisco.

## Setup and Usage
First, make sure that NodeJS and PostgreSQL are installed. Then, make a `.env` file including the following variables:
* `CLIENT_USER`: Username of the postgres DB to which should be connected
* `CLIENT_HOST`: Host address of postgres DB (can be `"localhost"`)
* `CLIENT_PASSWORD`: Password of the postgress account to which is connected
* `CLIENT_PORT`: Port of the postgres DB
* `CLIENT_DB`: The name of the postgres DB
* `OPA_API_URL`: The base URL of the Overpass API to use, such as `https://overpass-api.de/api/interpreter`
* `GEOCODING_API_KEY`: API key for the geocoding service that is used. Get an API key at `geocode.maps.co`
* `LOGS_OFF` (optional): Set this to `"true"` to turn off saving logs to text files

Run `npm install` to install the dependencies, then run `node main.js` for the main scraping. There is also a file called `dbHelper.js` which contains some useful utility functions (like clearing logs and resetting the DB).

## Code Description

The function where all of the following features are run is `main()`. Below is a list of the most important functionalities of this scraper.

### Points-Of-Interest Scraping
The core feature of this project is to scrape different sources, collect attributes about businesses, and store it as OAV (object-attribute-value) triplets in the DB. The main function here is `getGenericPoi()`, which combines data from Open Street maps, the DuckDuckGo search widget, and Yelp to try to get as much information as possible. This is done mostly within `getGenericPoi()` itself, but there are a few helper functions like `ddgPoiFetch()` and `getPoisFromOverpass()`. This generic POI scraping function is the starting point for all POI scraping.

Additionally, the code is made to be "modular" in the sense that it is easy to build on top of `getGenericPoi()`. The return values of this function can be further enhanced with data from other sources. For example, there is currently an implementation to scrape a cafe's menu website and price, which is defined as `getCafeAmenities()`.

### Events Scraping
Events can also be scraped. This happens in the `getEvents()` function, and data is obtained from Meetup and Eventbrite.

### Local News Scraping

News stories from local news outlets are scraped using `getLocalNews()`. Many neighborhoods in SF are supported, like Marina, Richmond, and more.

### Data Management

There are also some functions for data handling and syncing with the DB. `saveToPostgres()` directly pushes data to the DB, and `syncWithRemote()` adds only makes the necessary updates to the data on the DB (and it can also produce a CSV output of what changes the DB does not have).
