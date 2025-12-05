import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";

export default function Incidents() {
  const [incidents, setIncidents] = useState([]);

  const fetchIncidents = async () => {
    const res = await api.get("/incidents/");
    setIncidents(res.data);
  };

  useEffect(() => {
    fetchIncidents();
    const interval = setInterval(fetchIncidents, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="page">
      <header>
        <h1>Active Incidents</h1>
        <Link to="/units">Units</Link>
        <button
          onClick={() => {
            localStorage.removeItem("token");
            window.location.href = "/login";
          }}
        >
          Logout
        </button>
      </header>
      <ul>
        {incidents.map((inc) => (
          <li key={inc.id} className={`severity-${inc.severity.toLowerCase()}`}>
            <Link to={`/incidents/${inc.id}`}>
              <strong>{inc.title}</strong> - {inc.status}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
