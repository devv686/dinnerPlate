// src/geocode-nominatim.js
export async function geocodeNominatim(q, { country = "ca" } = {}) {
  const params = new URLSearchParams({
    q,
    format: "json",
    addressdetails: "0",
    limit: "1",
  });
  if (country) params.set("countrycodes", country); // bias to Canada

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    {
      headers: {
        "Accept-Language": "en-CA",
        // Browsers set User-Agent automatically; add a Referer for good-citizen use.
        Referer: window.location.origin,
      },
    }
  );

  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const hit = data[0];
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    display_name: hit.display_name,
  };
}
