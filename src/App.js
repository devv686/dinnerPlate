// src/App.js
import React, { useState, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import DonationForm from "./DonationForm";
import DinnerPlateUI from "./frontPage";
import { db } from "./firebase";
import { collection, onSnapshot, addDoc, doc, updateDoc } from "firebase/firestore";

// --- Config ---
// CRA proxy: keep base blank; frontend package.json must have: "proxy": "http://localhost:3001"
const API_BASE = "";

// --- Map icons ---
const icons = {
  empty: new L.Icon({
    iconUrl: "https://maps.google.com/mapfiles/ms/icons/red-dot.png",
    iconSize: [32, 32],
  }),
  "half-full": new L.Icon({
    iconUrl: "https://maps.google.com/mapfiles/ms/icons/yellow-dot.png",
    iconSize: [32, 32],
  }),
  full: new L.Icon({
    iconUrl: "https://maps.google.com/mapfiles/ms/icons/green-dot.png",
    iconSize: [32, 32],
  }),
};
// --- Deeplink helpers ---
function platformLinks(place, platforms, city = "Mississauga") {
  const name = place.name || "";
  const lat = place.lat, lng = place.lon;

  const searchLinks = {
    toogoodtogo: `https://www.google.com/search?q=${encodeURIComponent(`Too Good To Go ${name} ${city}`)}`,
    flashfood: `https://www.google.com/search?q=${encodeURIComponent(`Flashfood ${name} ${city}`)}`,
    foodhero: `https://www.google.com/search?q=${encodeURIComponent(`FoodHero ${name} ${city}`)}`,
  };

  const sureUrl = (key) =>
    platforms?.[key]?.status === "sure" && platforms?.[key]?.sample?.url
      ? platforms[key].sample.url
      : null;

  return {
    maps: lat != null && lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${city}`)}`,

    toogoodtogo: sureUrl("toogoodtogo") || searchLinks.toogoodtogo,
    flashfood: sureUrl("flashfood") || searchLinks.flashfood,
    foodhero: sureUrl("foodhero") || searchLinks.foodhero,
  };
}

// --- Deals fetcher (auto-expand radius until >= minResults) ---
async function fetchDealsAtLeast({ lat, lng, minResults = 5 }) {
  const radii = [500, 800, 1200, 2000, 3000, 5000];
  const seen = new Map();

  for (const r of radii) {
    const url = `${API_BASE}/api/dealsNearby?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(
      lng
    )}&radM=${r}&min=${minResults}`;
    const res = await fetch(url);
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
    if (!ct.includes("application/json")) throw new Error(`Non-JSON: ${ct}`);

    const data = JSON.parse(text);
    const items = Array.isArray(data?.results) ? data.results : [];
    for (const it of items) {
      if (it?.id != null && !seen.has(it.id)) seen.set(it.id, it);
    }
    if (seen.size >= minResults) break;
    // small pause to be polite to Overpass
    await new Promise((rsv) => setTimeout(rsv, 120));
  }
  return { results: Array.from(seen.values()) };
}

// --- checkDeals helper: strict “sure” only backend ---
async function verify(place) {
  const params = new URLSearchParams({
    name: place.name,
    city: "Mississauga",
    lat: place.lat,
    lng: place.lon,
  });
  const res = await fetch(`/api/checkDeals?${params.toString()}`);
  // backend never 500s in our latest version; still guard:
  if (!res.ok) throw new Error(`checkDeals failed: ${res.status}`);
  return res.json(); // { platforms: { toogoodtogo:{status}, flashfood:{status}, foodhero:{status} } }
}

function App() {
  const [tables, setTables] = useState([]);
  const [dealsByTable, setDealsByTable] = useState({});
  // Map: placeId -> { platforms?: {...}, checking?: boolean }
  const [dealChecks, setDealChecks] = useState({});

  // Live tables from Firestore
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "tables"),
      (snapshot) => {
        const items = snapshot.docs.map((d) => {
          const v = d.data();
          return {
            id: d.id,
            name: v.name || "(unnamed)",
            lat: Number(v.lat),
            lng: Number(v.lng),
            status: v.status || "empty",
            lastUpdated: v.lastUpdated || null,
          };
        });
        setTables(items);
      },
      (err) => console.error("Snapshot error:", err)
    );
    return () => unsub();
  }, []);

  // Add a new table
  const addTable = async (table) => {
    try {
      await addDoc(collection(db, "tables"), {
        ...table,
        name: table.name || "(unnamed)",
        status: table.status || "empty",
        lat: parseFloat(table.lat),
        lng: parseFloat(table.lng),
        lastUpdated: Date.now(),
      });
    } catch (err) {
      console.error("Failed to add table:", err);
      alert("Failed to add table. See console for details.");
    }
  };

  // Update table status
  const updateTableStatus = async (id, status) => {
    try {
      await updateDoc(doc(db, "tables", id), { status, lastUpdated: Date.now() });
    } catch (err) {
      console.error("Failed to update status:", err);
      alert("Failed to update status. See console for details.");
    }
  };

  // Auto-verify (quietly) up to first 8 places per load
  const autoVerifyPlaces = useCallback(
    async (places) => {
      const slice = places.slice(0, 8);
      for (const p of slice) {
        const pid = p.id;
        if (dealChecks[pid]?.platforms || dealChecks[pid]?.checking) continue;
        setDealChecks((s) => ({ ...s, [pid]: { ...(s[pid] || {}), checking: true } }));
        try {
          const info = await verify(p);
          setDealChecks((s) => ({ ...s, [pid]: { checking: false, platforms: info.platforms || null } }));
        } catch {
          setDealChecks((s) => ({ ...s, [pid]: { checking: false, platforms: null } }));
        }
        await new Promise((r) => setTimeout(r, 120));
      }
    },
    [dealChecks]
  );

  // Load deals for a specific table + trigger auto-verify
  const handleLoadDeals = useCallback(
    async (table) => {
      setDealsByTable((s) => ({ ...s, [table.id]: { loading: true, error: "", data: { results: [] } } }));
      try {
        const { results } = await fetchDealsAtLeast({ lat: table.lat, lng: table.lng, minResults: 5 });
        setDealsByTable((s) => ({ ...s, [table.id]: { loading: false, error: "", data: { results } } }));
        autoVerifyPlaces(results);
      } catch (e) {
        setDealsByTable((s) => ({
          ...s,
          [table.id]: { loading: false, error: String(e.message || e), data: { results: [] } },
        }));
      }
    },
    [autoVerifyPlaces]
  );

  return (
    <DinnerPlateUI />
    /* {<div className="App" style={{ padding: 12 }}>
      <h1>🍽️ Community Food Donation Tables</h1>

      <MapContainer
        center={[43.589, -79.644]}
        zoom={13}
        minZoom={11}
        style={{ height: "70vh", width: "100%", borderRadius: 8, marginTop: 8 }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />

        {tables.map((table) => {
          const dealState = dealsByTable[table.id] || { loading: false, error: "", data: { results: [] } };

          return (
            <Marker key={table.id} position={[table.lat, table.lng]} icon={icons[table.status] || icons.empty}>
              <Popup maxWidth={340}>
                <div style={{ lineHeight: 1.35 }}>
                  <strong>{table.name}</strong>
                  <br />
                  Status:&nbsp;
                  <select
                    value={table.status || "empty"}
                    onChange={(e) => updateTableStatus(table.id, e.target.value)}
                    className="border p-1 rounded"
                  >
                    <option value="empty">Empty</option>
                    <option value="half-full">Half-Full</option>
                    <option value="full">Full</option>
                  </select>
                  <br />
                  Last Updated:&nbsp;
                  {table.lastUpdated ? new Date(table.lastUpdated).toLocaleString() : "—"}
                </div>

                <hr />

                <div>
                  <button
                    onClick={() => handleLoadDeals(table)}
                    disabled={dealState.loading}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid #ccc",
                      cursor: dealState.loading ? "not-allowed" : "pointer",
                      background: dealState.loading ? "#eee" : "#fafafa",
                    }}
                  >
                    {dealState.loading ? "Loading nearby…" : "Show nearby deals"}
                  </button>

                  {dealState.error && (
                    <div style={{ color: "crimson", marginTop: 6 }}>Deals error: {dealState.error}</div>
                  )}

                  {(() => {
                    const list = Array.isArray(dealState.data?.results) ? dealState.data.results : [];
                    return (
                      <div style={{ marginTop: 8 }}>
                        <strong>Nearby deals:</strong>
                        <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
                          {list.length > 0 ? (
                            list.slice(0, 10).map((d, i) => {
                              const chk = dealChecks[d.id] || {};
                              const tSure = chk.platforms?.toogoodtogo?.status === "sure";
                              const fSure = chk.platforms?.flashfood?.status === "sure";
                              const hSure = chk.platforms?.foodhero?.status === "sure";

                              return (
                                <li key={i} style={{ marginBottom: 6 }}>
                                  {d.name || "Unnamed"} {d.distance ? `(${Math.round(d.distance)} m)` : ""}

                                  {(() => {
                                    const chk = dealChecks[d.id] || {};
                                    const tSure = chk.platforms?.toogoodtogo?.status === "sure";
                                    const fSure = chk.platforms?.flashfood?.status === "sure";
                                    const hSure = chk.platforms?.foodhero?.status === "sure";

                                    // Only show section if at least one is positive
                                    if (!(tSure || fSure || hSure)) return null;

                                    return (
                                      <div style={{ marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                                        {tSure && (
                                          <a
                                            href={chk.platforms?.toogoodtogo?.sample?.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{ fontSize: 12 }}
                                          >
                                            ✅ Too Good To Go
                                          </a>
                                        )}
                                        {fSure && (
                                          <a
                                            href={chk.platforms?.flashfood?.sample?.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{ fontSize: 12 }}
                                          >
                                            ✅ Flashfood
                                          </a>
                                        )}
                                        {hSure && (
                                          <a
                                            href={chk.platforms?.foodhero?.sample?.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{ fontSize: 12 }}
                                          >
                                            ✅ FoodHero
                                          </a>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </li>


                              );
                            })
                          ) : (
                            <li>No deals found yet.</li>
                          )}
                        </ul>
                      </div>
                    );
                  })()}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <div style={{ marginTop: 12 }}>
        <DonationForm addTable={addTable} />
      </div>
    </div> }*/
  );
}

export default App;
