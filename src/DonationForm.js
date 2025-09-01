// src/DonationForm.js
import React, { useState } from "react";

export default function DonationForm({ addTable }) {
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [status, setStatus] = useState("empty");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name || !lat || !lng) {
      alert("Please fill in all fields!");
      return;
    }

    addTable({
      name,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      status,
      lastUpdated: Date.now(),
    });
    setName("");
    setLat("");
    setLng("");
    setStatus("empty");
  };

  return (
    <form onSubmit={handleSubmit} className="p-4">
      <h2 className="font-bold mb-2">Add a Table</h2>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Table name"
        className="border p-1 mb-2 w-full"
      />
      <input
        value={lat}
        onChange={(e) => setLat(e.target.value)}
        placeholder="Latitude"
        className="border p-1 mb-2 w-full"
      />
      <input
        value={lng}
        onChange={(e) => setLng(e.target.value)}
        placeholder="Longitude"
        className="border p-1 mb-2 w-full"
      />
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="border p-1 mb-2 w-full"
      >
        <option value="empty">Empty</option>
        <option value="half-full">Half Full</option>
        <option value="full">Full</option>
      </select>
      <button
        type="submit"
        className="bg-green-600 text-white px-3 py-1 rounded"
      >
        Add
      </button>
    </form>
  );
}
