import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import MapView from "../map/MapView.jsx";

export default function Units() {
  const [units, setUnits] = useState([]);
  const [incidents, setIncidents] = useState([]);

  const fetchData = async () => {
    const [unitsRes, incidentsRes] = await Promise.all([
      api.get("/units/"),
      api.get("/incidents/"),
    ]);
    setUnits(unitsRes.data);
    setIncidents(incidentsRes.data);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="page">
      <header>
        <h1>Units</h1>
        <Link to="/">Incidents</Link>
      </header>
      <MapView incidents={incidents} units={units} includeUnits />
      <ul>
        {units.map((unit) => (
          <li key={unit.id}>
            <strong>{unit.name}</strong> - {unit.type} - {unit.availability_status}
          </li>
        ))}
      </ul>
    </div>
  );
}
