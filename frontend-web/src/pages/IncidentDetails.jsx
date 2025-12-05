import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../api/client";
import MapView from "../map/MapView.jsx";

export default function IncidentDetails() {
  const { id } = useParams();
  const [incident, setIncident] = useState(null);

  const fetchIncident = async () => {
    const res = await api.get(`/incidents/${id}/`);
    setIncident(res.data);
  };

  useEffect(() => {
    fetchIncident();
    const interval = setInterval(fetchIncident, 5000);
    return () => clearInterval(interval);
  }, [id]);

  if (!incident) return <p>Loading...</p>;

  return (
    <div className="page">
      <header>
        <h1>{incident.title}</h1>
        <Link to="/">Back</Link>
      </header>
      <p>{incident.description}</p>
      <MapView incidents={[incident]} includeUnits />
      <h3>Tasks</h3>
      <ul>
        {incident.tasks.map((task) => (
          <li key={task.id}>
            {task.title} - {task.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
