import React, { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";
import { collection, onSnapshot, updateDoc, doc, addDoc } from "firebase/firestore";
import { geocodeNominatim } from "./geocode-nominatim";

import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Modal from "react-modal";
Modal.setAppElement("#root");

import {
  Loader2,
  MapPinned,
  Search,
  Store,
  Info,
  RefreshCw,
  Filter,
  ChevronDown,
  ChevronUp,
  MapPin,
  ExternalLink,
} from "lucide-react";

/** Config */
const COLLECTION = process.env.REACT_APP_TABLES_COLLECTION || "tables";
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const OVERPASS_RADIUS_M = 1200; // 1.2 km

/** Status (unchanged colours) */
const STATUS_META = {
  empty: { label: "Empty", color: "#ef4444" },
  "half-full": { label: "Half-full", color: "#f59e0b" },
  full: { label: "Full", color: "#22c55e" },
};
const useStatusColor = (status) => STATUS_META[status]?.color ?? "#6b7280";

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: "Unknown", color: "#6b7280" };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border"
      style={{ borderColor: meta.color, color: meta.color }}
    >
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}

/** Utils */
function getLatLng(data) {
  const lat = Number(data?.lat);
  const lng = Number(data?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

function FitToMarkers({ points }) {
  const map = useMap();
  useEffect(() => {
    const valid = (points || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
    if (!valid.length) return;
    const latLngs = valid.map((p) => [p.lat, p.lng]);
    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds.pad(0.2));
  }, [points, map]);
  return null;
}

function distanceM(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180;
  const la2 = b.lat * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Overpass (nearby shops) */
async function fetchOverpassDeals(lat, lng) {
  const query = `
    [out:json][timeout:25];
    (
      node(around:${OVERPASS_RADIUS_M},${lat},${lng})["shop"~"supermarket|greengrocer|convenience|bakery"];
      way(around:${OVERPASS_RADIUS_M},${lat},${lng})["shop"~"supermarket|greengrocer|convenience|bakery"];
    );
    out center tags;
  `;
  const res = await fetch(`${OVERPASS_ENDPOINT}?data=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Overpass error ${res.status}`);
  const data = await res.json();
  const items = (data.elements || [])
    .map((el) => {
      const p = el.type === "node" ? { lat: el.lat, lng: el.lon } : { lat: el.center?.lat, lng: el.center?.lon };
      return {
        id: `${el.type}-${el.id}`,
        name: el.tags?.name || el.tags?.brand || "Unnamed place",
        shop: el.tags?.shop || "",
        opening_hours: el.tags?.opening_hours || "",
        lat: Number(p.lat),
        lng: Number(p.lng),
        url: el.tags?.website || el.tags?.url || null,
      };
    })
    .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));

  const here = { lat, lng };
  items.forEach((it) => (it.distance = Math.round(distanceM(here, it))));
  items.sort((a, b) => a.distance - b.distance);

  const seen = new Set();
  return items.filter((it) => {
    const key = `${(it.name || "").toLowerCase()}|${it.shop}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

export default function FrontPage() {
  //format = current value, function to update value, initial value

  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(true);

  // selection + deals
  const [selected, setSelected] = useState(null);
  const [deals, setDeals] = useState([]);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [dealsError, setDealsError] = useState(null);

  // ADD BY ADDRESS (INSIDE component)
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newStatus, setNewStatus] = useState("empty");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);
  const [addResolvedAddr, setAddResolvedAddr] = useState("");


  //help modal 
  const openHelp = () => setIsHelpOpen(true);
  const closeHelp = () => setIsHelpOpen(false);
  // Subscribe to Firestore
  useEffect(() => {
    setLoading(true);
    setErr(null);
    const unsub = onSnapshot(
      collection(db, COLLECTION),
      (snap) => {
        const next = snap.docs
          .map((d) => {
            const data = d.data();
            const pos = getLatLng(data);
            if (!pos) return null;
            const s = String(data.status || "").toLowerCase().trim();
            const normalized = s === "full" ? "full" : s === "empty" ? "empty" : "half-full";
            return {
              id: d.id,
              name: data.name ?? "Unnamed Table",
              address: data.address ?? "",
              lat: pos.lat,
              lng: pos.lng,
              status: normalized,
              notes: data.notes ?? "",
              lastUpdated: data.lastUpdated ?? 0,
            };
          })
          .filter(Boolean);
        setTables(next);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        setErr("Failed to read from Firestore. Check collection name/rules/fields.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Fetch deals when a table is selected
  useEffect(() => {
    let abort = false;
    async function run() {
      if (!selected) return;
      setDeals([]);
      setDealsError(null);
      setDealsLoading(true);
      try {
        const rows = await fetchOverpassDeals(selected.lat, selected.lng);
        if (!abort) setDeals(rows);
      } catch (e) {
        console.error(e);
        if (!abort) setDealsError("Couldn’t load nearby places right now.");
      } finally {
        if (!abort) setDealsLoading(false);
      }
    }
    run();
    return () => { abort = true; };
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tables.filter((t) => {
      const matchesQuery = !q || `${t.name} ${t.address}`.toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" ? true : t.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [tables, query, statusFilter]);

  async function updateStatus(table, next) {
    try {
      await updateDoc(doc(db, COLLECTION, table.id), {
        status: next,
        lastUpdated: Date.now(),
      });
    } catch (e) {
      console.error(e);
    }
  }

  // Add table by address handler
  async function onAddByAddress(e) {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    setAddResolvedAddr("");

    try {
      const name = newName.trim();
      const addr = newAddress.trim();
      if (!name || !addr) throw new Error("Please enter both a name and an address.");

      const geo = await geocodeNominatim(addr); // {lat,lng,display_name} | null
      if (!geo) throw new Error("Couldn’t geocode that address. Try adding city/province.");

      await addDoc(collection(db, COLLECTION), {
        name,
        address: geo.display_name,
        lat: geo.lat,
        lng: geo.lng,
        status: newStatus,
        notes: "",
        lastUpdated: Date.now(),
      });

      setAddResolvedAddr(geo.display_name);
      setNewName("");
      setNewAddress("");
      setNewStatus("empty");
    } catch (err) {
      console.error(err);
      setAddError(err?.message || "Failed to add table.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-rose-50 to-amber-50">
      {/* Header */}
      <div className="absolute left-0 right-0 top-0 z-20 flex justify-center p-3">
        <div className="flex w-full max-w-7xl items-center justify-between rounded-2xl border border-rose-200 bg-white/80 px-4 py-2 shadow backdrop-blur">
          <div className="text-rose-700 flex items-center gap-2 font-semibold">
            <MapPinned className="h-5 w-5" />
            <span>DinnerPlate · Mississauga Food Donation Tables</span>
          </div>
          <button
            onClick={() => setShowFilters((s) => !s)}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-1.5 border border-rose-200 hover:bg-rose-100"
          >
            <Filter className="h-4 w-4" />
            Filters {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="absolute inset-0 top-[64px] z-10 grid grid-cols-1 md:grid-cols-3 gap-0">
        {/* LEFT: Map + Deals */}
        <div className="md:col-span-2 border-r border-rose-200 h-full overflow-y-auto">
          {/* Map (compact) */}
          <div className="p-3">
            <div className="rounded-2xl overflow-hidden border border-rose-200 bg-rose-50">
              <div className="h-[380px] w-full">
                <MapContainer center={[43.6, -79.65]} zoom={12} className="h-full w-full">
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution="&copy; OpenStreetMap"
                  />

                  {filtered.map((t) => (
                    <CircleMarker
                      key={t.id}
                      center={[t.lat, t.lng]}
                      radius={10}
                      pathOptions={{
                        color: useStatusColor(t.status),
                        fillColor: useStatusColor(t.status),
                        fillOpacity: 0.65,
                      }}
                      eventHandlers={{ click: () => setSelected(t) }}
                    >
                      <Popup>
                        <div className="space-y-2">
                          <div className="font-semibold">{t.name}</div>
                          <div className="text-sm text-stone-700">{t.address}</div>
                          <div className="flex items-center gap-2 text-sm">
                            <StatusBadge status={t.status} />
                            {t.notes && (
                              <span className="inline-flex items-center gap-1 text-stone-700">
                                <Info className="h-3.5 w-3.5" /> {t.notes}
                              </span>
                            )}
                          </div>
                          <button
                            className="mt-2 inline-flex items-center gap-2 rounded-md border border-rose-200 px-2 py-1 text-sm hover:bg-rose-50"
                            onClick={() => setSelected(t)}
                          >
                            <MapPin className="h-4 w-4" />
                            Show nearby deals
                          </button>
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}

                  <FitToMarkers points={filtered.map((t) => ({ lat: t.lat, lng: t.lng }))} />
                </MapContainer>
              </div>
            </div>
          </div>

          {/* Deals under the map */}
          <div className="px-3 pb-3">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  Nearby fresh food deals
                  <span className="ml-2 text-sm text-stone-600">
                    {selected ? `(around ${selected.name})` : "(select a table)"}
                  </span>
                </div>
                <div className="text-xs text-stone-600">
                  within ~{Math.round(OVERPASS_RADIUS_M / 100) / 10} km
                </div>
              </div>

              {!selected && (
                <div className="mt-2 text-sm text-stone-700">
                  Click a table on the map or in the list to load nearby places.
                </div>
              )}

              {selected && dealsLoading && (
                <div className="mt-2 text-sm text-stone-700 inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading nearby places…
                </div>
              )}

              {selected && dealsError && (
                <div className="mt-2 text-sm text-red-700 border border-red-200 bg-red-50 rounded-md px-2 py-1">
                  {dealsError}
                </div>
              )}

              {selected && !dealsLoading && !dealsError && deals.length === 0 && (
                <div className="mt-2 text-sm text-stone-700">
                  No nearby places found.
                </div>
              )}

              {selected && deals.length > 0 && (
                <ul className="mt-2 grid sm:grid-cols-2 gap-2">
                  {deals.map((p) => (
                    <li key={p.id} className="rounded-lg border border-rose-200 bg-white/70 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{p.name}</div>
                          <div className="text-xs text-stone-700">
                            {p.shop} · {p.distance} m
                            {p.opening_hours ? ` · ${p.opening_hours}` : ""}
                          </div>
                        </div>
                        {p.url && (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs underline"
                          >
                            site <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: Filters + Add-by-address + List */}
        <div className="md:col-span-1 bg-rose-50 h-full overflow-y-auto">
          {showFilters && (
            <div className="sticky top-0 z-10 space-y-3 border-b border-rose-200 bg-rose-50/95 p-3 backdrop-blur">
              <label className="flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 bg-white/70">
                <Search className="h-4 w-4" />
                <input
                  className="w-full outline-none bg-transparent"
                  placeholder="Search name or address..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>

              <label className="flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 bg-white/70">
                <Store className="h-4 w-4" />
                <select
                  className="w-full bg-transparent outline-none"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="full">Full</option>
                  <option value="half-full">Half-full</option>
                  <option value="empty">Empty</option>
                </select>
              </label>

              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 border border-rose-200 hover:bg-rose-100 w-full justify-center"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>

              {/* Legend */}
              <div className="flex items-center gap-4 p-3 border border-rose-200 rounded-xl bg-rose-50">
                {["full", "half-full", "empty"].map((key) => {
                  const meta = STATUS_META[key] || { label: key, color: "#6b7280" };
                  return (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: meta.color }} />
                      <span>{meta.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* ADD BY ADDRESS (right panel) */}
              <form onSubmit={onAddByAddress} className="space-y-2 rounded-xl border border-rose-200 bg-white/70 p-3">
                <div className="font-medium">Add table by address</div>
                <input
                  className="w-full rounded-md border border-rose-200 px-2 py-1"
                  placeholder="Table name (e.g., Port Credit Pantry)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <input
                  className="w-full rounded-md border border-rose-200 px-2 py-1"
                  placeholder="Street address (city/province helps)"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                />
                <select
                  className="w-full rounded-md border border-rose-200 px-2 py-1"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                >
                  <option value="empty">Empty</option>
                  <option value="half-full">Half-full</option>
                  <option value="full">Full</option>
                </select>
                <button
                  type="submit"
                  disabled={adding}
                  className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 hover:bg-rose-100 disabled:opacity-50"
                >
                  {adding ? "Adding…" : "Add table"}
                </button>
                {addResolvedAddr && (
                  <div className="text-xs text-stone-700">
                    Address resolved to: <span className="font-medium">{addResolvedAddr}</span>
                  </div>
                )}
                {addError && (
                  <div className="text-xs text-red-700 border border-red-200 bg-red-50 rounded-md px-2 py-1">
                    {addError}
                  </div>
                )}
              </form>
            </div>
          )}

          {/* List */}
          <div className="p-3">
            <h2 className="text-lg font-semibold text-rose-700 mb-2">
              Tables ({filtered.length})
            </h2>

            {loading && (
              <div className="flex items-center gap-2 text-stone-700">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading from Firestore…
              </div>
            )}

            {!loading && !err && filtered.length === 0 && (
              <div className="text-stone-700 text-sm">
                No tables found in “{COLLECTION}”. Ensure docs have numeric/string <code>lat</code> and <code>lng</code>.
              </div>
            )}

            {err && (
              <div className="text-red-700 text-sm border border-red-200 bg-red-50 p-2 rounded-xl">
                {err}
              </div>
            )}

            <ul className="space-y-2 mt-2">
              {filtered.map((t) => {
                const active = selected?.id === t.id;
                return (
                  <li
                    key={t.id}
                    onClick={() => setSelected(t)}
                    className={`p-3 border rounded-xl bg-white/70 cursor-pointer transition
                      ${active ? "border-rose-400 ring-1 ring-rose-300 shadow-lg" : "border-rose-200 hover:shadow-md"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{t.name}</div>
                        <div className="text-sm text-stone-700 truncate">{t.address}</div>
                      </div>
                      <StatusBadge status={t.status} />
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                      <button
                        onClick={(e) => { e.stopPropagation(); updateStatus(t, "full"); }}
                        className="border border-rose-200 rounded-md px-2 py-1 hover:bg-rose-50"
                      >
                        Full
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); updateStatus(t, "half-full"); }}
                        className="border border-rose-200 rounded-md px-2 py-1 hover:bg-rose-50"
                      >
                        Half
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); updateStatus(t, "empty"); }}
                        className="border border-rose-200 rounded-md px-2 py-1 hover:bg-rose-50"
                      >
                        Empty
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

          </div>
        </div>
      </div>

      {/* Bottom-left badges */}
      <div className="absolute left-4 bottom-4 z-30 space-y-2">
        {loading && (
          <div className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 shadow">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
      </div>
        <button onClick={openHelp} style={{ position: "fixed", bottom: "20px", right: "20px", padding: "10px", background: "#ff8c42", color: "white", border: "none", borderRadius: "8px", cursor: "pointer" }}>
        ❓ Help
      </button>

      <Modal
        isOpen={isHelpOpen}
        onRequestClose={closeHelp}
        style={{
          content: {
            maxWidth: "500px",
            margin: "auto",
            padding: "20px",
            borderRadius: "8px"
          },
          overlay: {
            backgroundColor: "rgba(0,0,0,0.6)"
          }
        }}
      >
        <h2>How Dinnerplate Works</h2>
        <p>
          Welcome to Dinnerplate 🍽️ — your community food donation platform.
        </p>
        <ul>
          <li><strong>Donors:</strong> Post available food items with details like quantity and expiry.</li>
          <li><strong>Recipients:</strong> Browse available donations and claim what you need.</li>
          <li><strong>Capacity:</strong> Check availability before claiming — the table updates in real time.</li>
        </ul>
        <button onClick={closeHelp} style={{ background: "#ff4b5c", color: "white", padding: "8px", border: "none", borderRadius: "5px", cursor: "pointer" }}>
          Close
        </button>
      </Modal>
    </div>
  );
}
