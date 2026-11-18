import { useEffect, useState } from "react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000/api/v1";

export default function App() {
  const [health, setHealth] = useState("checking...");

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE_URL}/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data) => {
        if (active) setHealth(data.status || "ok");
      })
      .catch(() => {
        if (active) setHealth("unreachable");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <h1>Vinergy</h1>
      <p>
        Academic demo for finding charging/swapping stations and reserving one
        compatible battery. <strong>Simulated data only.</strong>
      </p>
      <p>
        Backend health (<code>{API_BASE_URL}/health</code>):{" "}
        <strong>{health}</strong>
      </p>
    </main>
  );
}
