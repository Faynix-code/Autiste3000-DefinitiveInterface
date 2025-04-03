"use client";
import { useEffect, useState, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function Home() {
  // Stocker les dernières valeurs reçues pour chaque type de données
  const [sensorValues, setSensorValues] = useState({});
  // Stocker l'historique des données pour les graphiques
  const [chartData, setChartData] = useState([]);
  // État de connexion WebSocket
  const [status, setStatus] = useState("Déconnecté");
  // Historique des messages bruts reçus
  const [textData, setTextData] = useState([]);
  // Message de statut actuel
  const [statusMessage, setStatusMessage] = useState('');
  // Référence à la connexion WebSocket
  const wsRef = useRef(null);
  // Configuration du serveur
  const [serverUrl, setServerUrl] = useState("ws://localhost:8765/");
  // Compteur pour ajouter un index aux points du graphique
  const dataPointIndex = useRef(0);

  // Fonction de connexion WebSocket avec reconnexion automatique
  const connectWebSocket = () => {
    try {
      const socket = new WebSocket(serverUrl);

      socket.onopen = () => {
        setStatus("Connecté 🔗");
        toast.success("Connexion établie");
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
        toast.error("Erreur de connexion");
      };

      socket.onmessage = (event) => {
        try {
          const parsedData = JSON.parse(event.data);
          console.log("Message reçu:", parsedData);

          // Gestion des alertes de statut
          if (parsedData.alert) {
            // Affichage des alertes
            toast.info(parsedData.alert);
            setStatusMessage(parsedData.alert);
            return;
          }

          // Si c'est un message système ou de bienvenue
          if (parsedData.system) {
            toast.info(parsedData.message || "Message système reçu");
            return;
          }

          // Traitement des données de capteurs
          if (parsedData.name && parsedData.value !== undefined) {
            const timestamp = new Date().toLocaleTimeString();
            
            // Mise à jour des dernières valeurs
            setSensorValues(prev => ({
              ...prev,
              [parsedData.name]: parsedData.value
            }));

            // Ajout du point au graphique
            const newDataPoint = {
              id: dataPointIndex.current++,
              timestamp,
              [parsedData.name]: parsedData.value
            };

            setChartData(prev => {
              const newData = [...prev, newDataPoint];
              // Garder seulement les 50 derniers points pour éviter une surcharge
              return newData.slice(-50);
            });

            // Ajout aux données textuelles
            if (parsedData.raw_data) {
              setTextData(prev => {
                const newTextData = [...prev, `[${timestamp}] ${parsedData.raw_data}`];
                return newTextData.slice(-100); // Limiter à 100 entrées
              });
            }

            // Vérification spécifique pour "status"
            if (parsedData.name === "status") {
              if (parsedData.value === 1) {
                setStatusMessage("L'autiste va bien 😊");
              } else if (parsedData.value === 2) {
                setStatusMessage("L'autiste ne va pas bien 😟");
              }
            }
          }
        } catch (error) {
          console.error("Erreur de parsing JSON:", error);
        }
      };

      wsRef.current = socket;
    } catch (error) {
      console.error("Erreur lors de la création du WebSocket:", error);
      toast.error("Impossible de se connecter au serveur");
    }
  };

  useEffect(() => {
    connectWebSocket(); // Initialisation de la connexion WebSocket

    return () => {
      if (wsRef.current) {
        wsRef.current.close(); // Assurer que la connexion WebSocket est fermée lors du démontage du composant
      }
    };
  }, [serverUrl]);

  // Fonction pour changer l'URL du serveur
  const handleServerUrlChange = (e) => {
    setServerUrl(e.target.value);
  };

  // Fonction pour se reconnecter manuellement
  const handleReconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    connectWebSocket();
  };

  // Fonction pour effacer les données
  const handleClearData = () => {
    setChartData([]);
    setTextData([]);
    setSensorValues({});
    dataPointIndex.current = 0;
    toast.info("Données effacées");
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-6">
      <h1 className="text-3xl font-bold mb-4">📡 Dashboard Micro:bit</h1>
      
      {/* Section configuration et statut */}
      <div className="w-full max-w-4xl bg-gray-800 p-4 rounded-lg shadow-lg mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2">Statut: <span className={`font-semibold ${status.includes("Connecté") ? "text-green-400" : "text-red-400"}`}>{status}</span></p>
            
            <div className="flex items-center gap-2">
              <input 
                type="text" 
                value={serverUrl} 
                onChange={handleServerUrlChange} 
                className="bg-gray-700 text-white p-2 rounded"
                placeholder="ws://localhost:8765/"
              />
              <button 
                onClick={handleReconnect}
                className="bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded"
              >
                Reconnecter
              </button>
              <button 
                onClick={handleClearData}
                className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded"
              >
                Effacer données
              </button>
            </div>
          </div>
          
          {/* Section du message de statut */}
          {statusMessage && (
            <div className={`${statusMessage.includes("bien") ? "bg-green-600" : "bg-red-600"} text-white p-3 rounded-lg`}>
              <strong>Status :</strong> {statusMessage}
            </div>
          )}
        </div>
      </div>

      {/* Section des valeurs actuelles */}
      <div className="w-full max-w-4xl bg-gray-800 p-4 rounded-lg shadow-lg mb-6">
        <h2 className="text-xl font-semibold mb-4">📊 Valeurs actuelles</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {Object.entries(sensorValues).map(([name, value]) => (
            <div key={name} className="bg-gray-700 p-3 rounded-lg">
              <h3 className="font-medium text-gray-300">{name}</h3>
              <p className="text-2xl font-bold">{typeof value === 'number' ? value.toFixed(2) : value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Section des graphiques */}
      <div className="w-full max-w-4xl bg-gray-800 p-4 rounded-lg shadow-lg mb-6">
        <h2 className="text-xl font-semibold mb-4">📈 Graphiques en Temps Réel</h2>
        
        {chartData.length > 0 ? (
          <div className="overflow-x-auto">
            <LineChart width={700} height={300} data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#444" />
              <XAxis dataKey="timestamp" stroke="#fff" />
              <YAxis stroke="#fff" />
              <Tooltip contentStyle={{ backgroundColor: '#2d3748', color: '#fff', border: 'none' }} />
              <Legend />
              
              {/* Créer dynamiquement les lignes pour chaque type de capteur */}
              {Array.from(new Set(chartData.flatMap(point => Object.keys(point)))).filter(key => 
                key !== 'id' && key !== 'timestamp'
              ).map((sensorName, index) => {
                // Couleurs pour les différentes lignes
                const colors = ['#8884d8', '#82ca9d', '#ff7300', '#ffcc00', '#0088FE', '#00C49F', '#FFBB28'];
                return (
                  <Line 
                    key={sensorName}
                    type="monotone" 
                    dataKey={sensorName}
                    stroke={colors[index % colors.length]}
                    name={sensorName} 
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                );
              })}
            </LineChart>
          </div>
        ) : (
          <p className="text-gray-400 italic">En attente de données...</p>
        )}
      </div>

      {/* Section des données textuelles */}
      <div className="w-full max-w-4xl bg-gray-800 p-4 rounded-lg shadow-lg">
        <h2 className="text-xl font-semibold mb-2">📄 Données brutes</h2>
        <div className="bg-gray-700 p-4 rounded-lg max-h-60 overflow-y-auto">
          {textData.length > 0 ? (
            textData.map((item, index) => (
              <div key={index} className="border-b border-gray-600 py-1 text-sm">{item}</div>
            ))
          ) : (
            <p className="text-gray-400 italic">En attente de données...</p>
          )}
        </div>
      </div>

      <ToastContainer position="bottom-right" theme="dark" />
    </div>
  );
}