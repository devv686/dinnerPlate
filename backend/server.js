// backend/server.js
import express from "express";
import cors from "cors";
import dealsNearby from "./dealsNearby.js"; // now inside backend/

const app = express();
const PORT = process.env.PORT || 3001;

import checkDeals from "./checkDeals.js";
app.get("/api/checkDeals", checkDeals);

app.use(cors());
app.use(express.json());

// simple in-memory data for demo
let tables = [];

// mount the deals endpoint
// GET /api/dealsNearby?lat=43.7&lng=-79.4&radM=500
app.get("/api/dealsNearby", dealsNearby);

// tables endpoints
app.get("/api/tables", (req, res) => {
  res.json({ success: true, data: tables, count: tables.length });
});

app.post("/api/tables", (req, res) => {
  const newTable = { id: Date.now(), ...req.body, lastUpdated: Date.now() };
  tables.push(newTable);
  res.json(newTable);
});

app.put("/api/tables/:id/status", (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  tables = tables.map((t) =>
    String(t.id) === String(id) ? { ...t, status, lastUpdated: Date.now() } : t
  );
  res.json({ message: "Status updated" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
