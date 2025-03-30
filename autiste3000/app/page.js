"use client";
import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function Home() {
  const [data, setData] = useState([]);
  const [status, setStatus] = useState("Déconnecté");
  const [textData, setTextData] = useState([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [ws, setWs] = useState(null);

  // Fonction de connexion WebSocket avec reconnexion automatique
  const connectWebSocket = () => {
    const socket = new WebSocket("ws://localhost:8765");

    socket.onopen = () => {
      setStatus("Connecté 🔗");
      console.log("WebSocket ouvert");
    };

    socket.onclose = (event) => {
      setStatus("Déconnecté ❌");
      console.log("WebSocket fermé", event);
      // Tentative de reconnexion après 3 secondes
      setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (error) => {
      console.error("WebSocket Error:", error);
    };

    socket.onmessage = (event) => {
      try {
        const parsedData = JSON.parse(event.data);

        // Mise à jour des graphiques
        setData((prev) => [...prev.slice(-20), parsedData]);

        // Gestion des données textuelles
        if (parsedData.raw_data) {
          setTextData((prevTextData) => [...prevTextData, parsedData.raw_data]);
        }

        // Gestion du statut "status"
        if (parsedData.status === 1) {
          setStatusMessage('L\'autiste va bien');
          toast.success('L\'autiste va bien');
        } else if (parsedData.status === 2) {
          setStatusMessage('L\'autiste ne va pas bien');
          toast.error('L\'autiste ne va pas bien');
        }
      } catch (error) {
        console.error("Erreur de parsing JSON:", error);
      }
    };

    setWs(socket);
  };

  useEffect(() => {
    connectWebSocket(); // Initialisation de la connexion WebSocket

    return () => {
      if (ws) {
        ws.close(); // Assurer que la connexion WebSocket est fermée lors du démontage du composant
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-6">
      <h1 className="text-3xl font-bold mb-4">📡 Dashboard Micro:bit</h1>
      <p className="mb-4">Statut de connexion : <span className="font-semibold">{status}</span></p>

      {/* Section du message de statut */}
      {statusMessage && (
        <div className="bg-blue-500 text-white p-4 rounded-lg mb-4">
          <strong>Status :</strong> {statusMessage}
        </div>
      )}

      {/* Section des graphiques */}
      <div className="w-full max-w-4xl bg-gray-800 p-4 rounded-lg shadow-lg mb-6">
        <h2 className="text-xl font-semibold mb-2">📊 Graphiques en Temps Réel</h2>

        <LineChart width={700} height={300} data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#444" />
          <XAxis dataKey="time" stroke="#fff" />
          <YAxis stroke="#fff" />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="accelerationx" stroke="#8884d8" name="Accélération X" />
          <Line type="monotone" dataKey="accelerationy" stroke="#82ca9d" name="Accélération Y" />
          <Line type="monotone" dataKey="temperature" stroke="#ff7300" name="Température" />
          <Line type="monotone" dataKey="niveausonore" stroke="#ffcc00" name="Niveau Sonore" />
        </LineChart>
      </div>

      {/* Section des données textuelles */}
      <div className="w-full max-w-4xl bg-gray-800 p-4 rounded-lg shadow-lg">
        <h2 className="text-xl font-semibold mb-2">📄 Données Textuelles</h2>
        <pre className="bg-gray-700 p-4 rounded-lg">
          {textData.map((item, index) => (
            <div key={index}>{item}</div>
          ))}
        </pre>
      </div>

      <ToastContainer />
    </div>
  );
}
