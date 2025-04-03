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
  // Debug: Compteur de messages reçus
  const [messageCount, setMessageCount] = useState(0);
  
  // Buffer pour accumuler les données dans un même intervalle de temps
  const dataBuffer = useRef({});
  // Timer pour regrouper les données
  const bufferTimer = useRef(null);

  // Liste des types de capteurs attendus
  const expectedSensors = ["temperature", "niveausonore", "signal", "accelerationx", "accelerationy"];

  // Fonction pour traiter et enregistrer les données bufferisées
  const processBufferedData = () => {
    const currentBuffer = dataBuffer.current;
    
    if (Object.keys(currentBuffer).length > 0) {
      const timestamp = new Date().toLocaleTimeString();
      
      // Création d'un nouveau point de données avec toutes les valeurs bufferisées
      const newDataPoint = {
        id: dataPointIndex.current++,
        timestamp
      };

      // Fusionner toutes les valeurs du buffer dans ce point
      Object.entries(currentBuffer).forEach(([name, value]) => {
        newDataPoint[name] = value;
      });

      // Mettre à jour le graphique
      setChartData(prev => {
        const newData = [...prev, newDataPoint];
        // Garder seulement les 50 derniers points pour éviter une surcharge
        return newData.slice(-50);
      });

      // Réinitialiser le buffer
      dataBuffer.current = {};
    }
  };

  // Fonction de connexion WebSocket avec reconnexion automatique
  const connectWebSocket = () => {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }

      console.log("Tentative de connexion à", serverUrl);
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
        setMessageCount(prev => prev + 1); // Debug: incrémenter le compteur
        console.log("Message brut reçu:", event.data);
        
        try {
          const parsedData = JSON.parse(event.data);
          console.log("Message parsé:", parsedData);

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
            
            // Debug
            console.log(`Mise à jour de ${parsedData.name} avec la valeur ${parsedData.value}`);
            
            // Mise à jour des dernières valeurs
            setSensorValues(prev => {
              const newValues = {
                ...prev,
                [parsedData.name]: parsedData.value
              };
              console.log("Nouvelles valeurs de capteurs:", newValues);
              return newValues;
            });

            // Ajouter au buffer
            dataBuffer.current[parsedData.name] = parsedData.value;
            
            // Réinitialiser le timer à chaque nouvelle donnée
            clearTimeout(bufferTimer.current);
            bufferTimer.current = setTimeout(processBufferedData, 1000);

            // Ajout aux données textuelles
            setTextData(prev => {
              const rawDataMessage = parsedData.raw_data || `${parsedData.name},${parsedData.value}`;
              const newTextData = [...prev, `[${timestamp}] ${rawDataMessage}`];
              return newTextData.slice(-100); // Limiter à 100 entrées
            });

            // Vérification spécifique pour "status"
            if (parsedData.name === "status") {
              if (parsedData.value === 1) {
                setStatusMessage("L'autiste va bien 😊");
              } else if (parsedData.value === 2) {
                setStatusMessage("L'autiste ne va pas bien 😟");
              }
            }
          } else {
            console.warn("Message reçu sans nom ou valeur:", parsedData);
          }
        } catch (error) {
          console.error("Erreur de parsing JSON:", error, "Données brutes:", event.data);
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
      // Nettoyage lorsque le composant est démonté
      if (wsRef.current) {
        wsRef.current.close();
      }
      
      if (bufferTimer.current) {
        clearTimeout(bufferTimer.current);
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
    setMessageCount(0); // Reset du compteur de debug
    dataBuffer.current = {}; // Vider le buffer
    toast.info("Données effacées");
  };

  // Fonction pour envoyer un message test au serveur
  const handleTestMessage = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({type: "ping", timestamp: new Date().toISOString()}));
      toast.info("Message de test envoyé");
    } else {
      toast.error("WebSocket non connecté");
    }
  };
  
  // Génération de couleurs cohérentes pour chaque type de capteur
  const getSensorColor = (sensorName) => {
    const colorMap = {
      temperature: "#ff7300",
      niveau_sonore: "#82ca9d", 
      signal: "#8884d8",
      accelerationX: "#0088FE",
      accelerationY: "#00C49F",
      status: "#FFBB28"
    };
    
    return colorMap[sensorName] || "#999999"; // Couleur par défaut
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-6">
      <h1 className="text-3xl font-bold mb-4">📡 Dashboard Micro:bit</h1>
      
      {/* Section configuration et statut */}
      <div className="w-full max-w-4xl bg-gray-800 p-4 rounded-lg shadow-lg mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2">
              Statut: <span className={`font-semibold ${status.includes("Connecté") ? "text-green-400" : "text-red-400"}`}>{status}</span>
              {" "}<small>({messageCount} messages reçus)</small>
            </p>
            
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
              <button 
                onClick={handleTestMessage}
                className="bg-yellow-600 hover:bg-yellow-700 px-3 py-2 rounded"
              >
                Test
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
          {Object.keys(sensorValues).length > 0 ? (
            Object.entries(sensorValues).map(([name, value]) => (
              <div key={name} className="bg-gray-700 p-3 rounded-lg" style={{ borderLeft: `4px solid ${getSensorColor(name)}` }}>
                <h3 className="font-medium text-gray-300">{name}</h3>
                <p className="text-2xl font-bold">{typeof value === 'number' ? value.toFixed(2) : value}</p>
              </div>
            ))
          ) : (
            <div className="bg-gray-700 p-3 rounded-lg col-span-3">
              <p className="text-gray-400 italic">En attente de données...</p>
            </div>
          )}
        </div>
      </div>

      {/* Section des graphiques */}
      <div className="w-full max-w-4xl bg-gray-800 p-4 rounded-lg shadow-lg mb-6">
        <h2 className="text-xl font-semibold mb-4">📈 Graphiques en Temps Réel</h2>
        
        {chartData.length > 0 ? (
          <div className="overflow-x-auto">
            <LineChart 
              width={700} 
              height={300} 
              data={chartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#444" />
              <XAxis dataKey="timestamp" stroke="#fff" />
              <YAxis stroke="#fff" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#2d3748', color: '#fff', border: 'none' }} 
                formatter={(value, name) => [value.toFixed(2), name]}
              />
              <Legend />
              
              {/* Combiner les capteurs attendus et détectés pour s'assurer que tous sont affichés */}
              {Array.from(new Set([
                ...expectedSensors,
                ...Array.from(new Set(chartData.flatMap(point => Object.keys(point))))
              ])).filter(key => 
                key !== 'id' && key !== 'timestamp'
              ).map((sensorName) => (
                <Line 
                  key={sensorName}
                  type="monotone" 
                  dataKey={sensorName}
                  stroke={getSensorColor(sensorName)}
                  name={sensorName} 
                  connectNulls={true}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              ))}
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