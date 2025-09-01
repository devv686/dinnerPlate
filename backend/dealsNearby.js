// backend/dealsNearby.js
import axios from "axios";

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default async function handler(req, res) {
  const { lat, lng, radM } = req.query;
  if (!lat || !lng || !radM) {
    return res.status(400).json({ error: "Missing query parameters" });
  }

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  const radiusNum = parseFloat(radM);

  const overpassQuery = `
    [out:json];
    (
      node["amenity"="restaurant"](around:${radiusNum},${latNum},${lngNum});
      node["amenity"="cafe"](around:${radiusNum},${latNum},${lngNum});
    );
    out body;
    >;
    out skel qt;
  `;

  try {
    const response = await axios.post(
      "https://overpass-api.de/api/interpreter",
      overpassQuery,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const deals = (response.data.elements || []).map((el) => {
      const tags = el.tags || {};
      return {
        id: el.id,
        name: tags.name || "Unknown",
        amenity: tags.amenity || tags.shop || "unknown",
        opening_hours: tags.opening_hours || null,
        website: tags.website || tags.url || null,
        phone: tags.phone || null,
        address: {
          street: tags["addr:street"] || null,
          housenumber: tags["addr:housenumber"] || null,
          city: tags["addr:city"] || null,
          postcode: tags["addr:postcode"] || null,
          country: tags["addr:country"] || null,
        },
        distance: getDistance(latNum, lngNum, el.lat, el.lon),
        lat: el.lat,
        lon: el.lon,
        tags,
      };
    });

    deals.sort((a, b) => a.distance - b.distance);
    res.status(200).json({ results: deals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch data from Overpass API" });
  }
}
