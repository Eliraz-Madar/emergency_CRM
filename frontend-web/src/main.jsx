import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import FieldIncidentDashboard from "./pages/FieldIncidentDashboard.jsx";
import DashboardSelector from "./pages/DashboardSelector.jsx";
import "./styles.css";
import 'leaflet/dist/leaflet.css';

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardSelector />} />
        <Route path="/regional" element={<Dashboard />} />
        <Route path="/field-incident" element={<FieldIncidentDashboard />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
