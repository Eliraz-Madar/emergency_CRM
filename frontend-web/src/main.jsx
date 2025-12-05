import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Incidents from "./pages/Incidents.jsx";
import IncidentDetails from "./pages/IncidentDetails.jsx";
import Units from "./pages/Units.jsx";
import "./styles.css";

const App = () => {
  const token = localStorage.getItem("token");

  const Protected = ({ children }) => {
    if (!token) {
      return <Navigate to="/login" replace />;
    }
    return children;
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Protected>
              <Incidents />
            </Protected>
          }
        />
        <Route
          path="/incidents/:id"
          element={
            <Protected>
              <IncidentDetails />
            </Protected>
          }
        />
        <Route
          path="/units"
          element={
            <Protected>
              <Units />
            </Protected>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
