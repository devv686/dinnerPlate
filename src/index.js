import React from "react";
import ReactDOM from "react-dom/client";
import './index.css';
import FrontPage from './frontPage';   // 👈 import your new file

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <FrontPage />
  </React.StrictMode>
);
