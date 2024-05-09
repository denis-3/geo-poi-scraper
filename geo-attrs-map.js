const MAPPING = {
	"website": "f724b805-89e1-424b-b149-acff9ecfd0f7",
	"address": "9e98d3c2-c713-43fe-97ba-0eb0869c1f9c",
	"name": "name",
	"phoneNumber": "cb361409-4695-4676-b62f-c2290613a430",
	"decription": "5a667ac9-7e5e-4ffa-820a-ed2d77a8d8ba",
	"organizer": "f7423062-fb75-4928-8b63-156af138258b",
	"image": "457a27af-7b0b-485c-ac07-aa37756adafa",
	"avatar": "235ba0e8-dc7e-4bdd-a1e1-6d0d4497f133",
	"price": "d267c2ed-cad8-4e87-93ab-dbf95d6659cc"
}

function getGeoAttrId(attrText) {
	return MAPPING[attrText] ?? attrText
}

module.exports = getGeoAttrId
