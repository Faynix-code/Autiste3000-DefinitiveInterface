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
  // Debug: Compteur de messages reçus
  const [messageCount, setMessageCount] = useState(0);
  
  // Buffer pour stocker temporairement les données entre les rendus
  const dataBufferRef = useRef({});
  // Timer pour l'échantillonnage des données
  const samplingTimerRef = useRef(null);
  // Timestamp de la dernière mise à jour du graphique
  const lastUpdateRef = useRef(Date.now());
  // Variables non-rendues pour optimiser les performances
  const samplingInterval = 1000; // Intervalle d'échantillonnage en ms
  const maxDataPoints = 100; // Nombre maximal de points sur le graphique
  
  // Échantillonnage des données et mise à jour du graphique
  const updateChartData = () => {
    const now = Date.now();
    const buffer = dataBufferRef.current;
    
    // Créer un point de données seulement s'il y a des données dans le buffer
    if (Object.keys(buffer).length > 0) {
      const timestamp = new Date(now).toLocaleTimeString();
      
      // Création d'un nouveau point avec toutes les données accumulées
      // On utilise la moyenne des valeurs accumulées pour chaque capteur
      const newPoint = { timestamp };
      
      Object.entries(buffer).forEach(([sensor, values]) => {
        if (values.length > 0) {
          // Calculer la moyenne des valeurs pour ce capteur
          const sum = values.reduce((acc, val) => acc + val, 0);
          newPoint[sensor] = sum / values.length;
        }
      });
      
      // Mise à jour du graphique de manière optimisée
      setChartData(prevData => {
        const newData = [...prevData, newPoint];
        return newData.slice(-maxDataPoints);
      });
      
      // Réinitialiser le buffer après utilisation
      dataBufferRef.current = {};
    }
    
    lastUpdateRef.current = now;
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
        
        // Démarrer l'échantillonnage périodique
        if (samplingTimerRef.current) {
          clearInterval(samplingTimerRef.current);
        }
        samplingTimerRef.current = setInterval(updateChartData, samplingInterval);
      };

      socket.onclose = (event) => {
        setStatus("Déconnecté ❌");
        console.log("WebSocket fermé", event);
        
        // Arrêter l'échantillonnage
        if (samplingTimerRef.current) {
          clearInterval(samplingTimerRef.current);
        }
        
        // Tentative de reconnexion après 3 secondes
        setTimeout(connectWebSocket, 3000);
      };

      socket.onerror = (error) => {
        console.error("WebSocket Error:", error);
        toast.error("Erreur de connexion");
      };

      socket.onmessage = (event) => {
        // Incrémenter le compteur de messages
        setMessageCount(prev => prev + 1);
        
        try {
          const parsedData = JSON.parse(event.data);
          
          // Gestion des alertes et messages système
          if (parsedData.alert) {
            toast.info(parsedData.alert);
            setStatusMessage(parsedData.alert);
            return;
          }
          
          if (parsedData.system) {
            toast.info(parsedData.message || "Message système reçu");
            return;
          }

          // Traitement des données de capteurs
          if (parsedData.name && parsedData.value !== undefined) {
            const timestamp = new Date().toLocaleTimeString();
            const sensorName = parsedData.name;
            const sensorValue = typeof parsedData.value === 'string' ? 
              parseFloat(parsedData.value) : parsedData.value;
            
            // Mise à jour des valeurs actuelles (rendu moins fréquent)
            setSensorValues(prev => ({
              ...prev,
              [sensorName]: sensorValue
            }));
            
            // Ajouter la valeur au buffer pour l'échantillonnage
            if (!dataBufferRef.current[sensorName]) {
              dataBufferRef.current[sensorName] = [];
            }
            dataBufferRef.current[sensorName].push(sensorValue);
            
            // Limiter la quantité de logs de texte pour éviter la surcharge
            // Échantillonnage des logs textuels (1 sur 10 messages)
            if (Math.random() < 0.1) {
              const rawDataMessage = parsedData.raw_data || `${sensorName},${sensorValue}`;
              setTextData(prev => {
                const newTextData = [...prev, `[${timestamp}] ${rawDataMessage}`];
                return newTextData.slice(-100);
              });
            }

            // Traitement spécial pour le statut
            if (sensorName === "status") {
              if (sensorValue === 1) {
                setStatusMessage("L'autiste va bien 😊");
              } else if (sensorValue === 2) {
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
    connectWebSocket();

    return () => {
      // Nettoyage
      if (wsRef.current) {
        wsRef.current.close();
      }
      
      if (samplingTimerRef.current) {
        clearInterval(samplingTimerRef.current);
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
    dataBufferRef.current = {};
    setMessageCount(0);
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
              <XAxis 
                dataKey="timestamp" 
                stroke="#fff"
                interval="preserveStartEnd"
                minTickGap={25}
              />
              <YAxis stroke="#fff" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#2d3748', color: '#fff', border: 'none' }} 
                formatter={(value, name) => [value !== undefined ? value.toFixed(2) : 'N/A', name]}
              />
              <Legend />
              
              {/* Lignes pour chaque type de capteur */}
              {Object.keys(sensorValues).filter(name => 
                name !== 'id' && name !== 'timestamp' && name !== 'status'
              ).map((sensorName) => (
                <Line 
                  key={sensorName}
                  type="monotone" 
                  dataKey={sensorName}
                  stroke={getSensorColor(sensorName)}
                  name={sensorName}
                  connectNulls={true}
                  isAnimationActive={false} // Désactiver l'animation pour des performances améliorées
                  dot={false} // Supprimer les points pour améliorer les performances
                  activeDot={{ r: 4 }} // Garder un point actif pour l'interaction
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
        <h2 className="text-xl font-semibold mb-2">📄 Données brutes (échantillonnées)</h2>
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

      <ToastContainer 
        position="bottom-right" 
        theme="dark" 
        limit={3} 
        autoClose={2000}
      />
    </div>
  );
}