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
  // Stocker l'historique complet pour le filtrage temporel
  const chartDataFullRef = useRef([]);
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
  // Compteur de tentatives de reconnexion
  const reconnectAttemptsRef = useRef(0);
  // Identifiant du timer de reconnexion
  const reconnectTimerRef = useRef(null);
  // Flag pour savoir si on est en train de se reconnecter
  const isReconnectingRef = useRef(false);
  // Flag pour indiquer si la déconnexion est volontaire
  const isIntentionalDisconnectRef = useRef(false);
  // Timestamp de la dernière notification
  const lastNotificationRef = useRef(0);
  
  // Buffer pour stocker temporairement les données entre les rendus
  const dataBufferRef = useRef({});
  // Timer pour l'échantillonnage des données
  const samplingTimerRef = useRef(null);
  // Timer pour le rafraîchissement de l'affichage
  const displayRefreshTimerRef = useRef(null);
  // Timestamp de la dernière mise à jour du graphique
  const lastUpdateRef = useRef(Date.now());
  // Variables non-rendues pour optimiser les performances
  const samplingInterval = 1000; // Intervalle d'échantillonnage en ms
  const displayRefreshInterval = 1000; // Rafraîchissement de l'affichage en ms
  const maxDataPoints = 100; // Nombre maximal de points dans l'historique complet
  const dataTimeWindow = 15000; // Fenêtre temporelle pour l'affichage (15 secondes)
  
  // Fonction pour filtrer les données selon la fenêtre temporelle
  const filterDataByTimeWindow = () => {
    const now = Date.now();
    const cutoffTime = now - dataTimeWindow;
    
    // Convertir les timestamps de chaîne à objets Date pour la comparaison
    const filteredData = chartDataFullRef.current.filter(dataPoint => {
      // Chaque point doit avoir un timestamp réel stocké
      return dataPoint.rawTimestamp && dataPoint.rawTimestamp > cutoffTime;
    });
    
    // Mettre à jour l'état du graphique avec les données filtrées
    setChartData(filteredData);
  };
  
  // Échantillonnage des données et mise à jour de l'historique complet
  const updateChartData = () => {
    const now = Date.now();
    const buffer = dataBufferRef.current;
    
    // Créer un point de données seulement s'il y a des données dans le buffer
    if (Object.keys(buffer).length > 0) {
      const timestamp = new Date(now).toLocaleTimeString();
      
      // Création d'un nouveau point avec toutes les données accumulées
      // On utilise la moyenne des valeurs accumulées pour chaque capteur
      const newPoint = { 
        timestamp,
        rawTimestamp: now // Stocker le timestamp brut pour filtrage temporel
      };
      
      Object.entries(buffer).forEach(([sensor, values]) => {
        if (values.length > 0) {
          // Calculer la moyenne des valeurs pour ce capteur
          const sum = values.reduce((acc, val) => acc + val, 0);
          newPoint[sensor] = sum / values.length;
        }
      });
      
      // Mise à jour de l'historique complet de manière optimisée
      chartDataFullRef.current = [...chartDataFullRef.current, newPoint].slice(-maxDataPoints);
      
      // Filtrer les données selon la fenêtre temporelle
      filterDataByTimeWindow();
      
      // Réinitialiser le buffer après utilisation
      dataBufferRef.current = {};
    }
    
    lastUpdateRef.current = now;
  };
  
  // Fonction pour déterminer le délai avant nouvelle tentative (backoff exponentiel)
  const getReconnectDelay = () => {
    const baseDelay = 1000; // 1 seconde
    const maxDelay = 30000; // 30 secondes maximum
    const attempts = reconnectAttemptsRef.current;
    
    // Formule de backoff exponentiel: baseDelay * 2^attempts avec un max
    const delay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
    console.log(`Tentative de reconnexion ${attempts+1}, délai: ${delay}ms`);
    return delay;
  };
  
  // Fonction de notification avec limitation
  const showNotification = (message, type = 'info') => {
    const now = Date.now();
    // Limiter les notifications à une toutes les 5 secondes
    if (now - lastNotificationRef.current > 5000) {
      if (type === 'success') toast.success(message);
      else if (type === 'error') toast.error(message);
      else toast.info(message);
      
      lastNotificationRef.current = now;
    }
  };
  
  // Fonction de connexion WebSocket avec reconnexion automatique
  const connectWebSocket = () => {
    // Éviter les connexions multiples simultanées
    if (isReconnectingRef.current) return;
    
    try {
      isReconnectingRef.current = true;
      
      // Nettoyer toute connexion existante
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        isIntentionalDisconnectRef.current = true;
        wsRef.current.close();
        isIntentionalDisconnectRef.current = false;
      }

      console.log("Tentative de connexion à", serverUrl);
      setStatus("Connexion en cours...");
      
      const socket = new WebSocket(serverUrl);

      socket.onopen = () => {
        setStatus("Connecté 🔗");
        // Réinitialiser le compteur de tentatives après une connexion réussie
        reconnectAttemptsRef.current = 0;
        isReconnectingRef.current = false;
        
        // Afficher une notification seulement si ce n'est pas la première connexion
        if (messageCount > 0) {
          showNotification("Connexion rétablie", "success");
        } else {
          showNotification("Connexion établie", "success");
        }
        
        console.log("WebSocket ouvert");
        
        // Démarrer l'échantillonnage périodique
        if (samplingTimerRef.current) {
          clearInterval(samplingTimerRef.current);
        }
        samplingTimerRef.current = setInterval(updateChartData, samplingInterval);
        
        // Démarrer le rafraîchissement de l'affichage
        if (displayRefreshTimerRef.current) {
          clearInterval(displayRefreshTimerRef.current);
        }
        displayRefreshTimerRef.current = setInterval(filterDataByTimeWindow, displayRefreshInterval);
      };

      socket.onclose = (event) => {
        setStatus("Déconnecté ❌");
        isReconnectingRef.current = false;
        console.log("WebSocket fermé", event);
        
        // Arrêter l'échantillonnage et le rafraîchissement
        if (samplingTimerRef.current) {
          clearInterval(samplingTimerRef.current);
        }
        if (displayRefreshTimerRef.current) {
          clearInterval(displayRefreshTimerRef.current);
        }
        
        // Éviter la reconnexion si la fermeture était intentionnelle
        if (!isIntentionalDisconnectRef.current) {
          // Incrémenter le compteur de tentatives
          reconnectAttemptsRef.current++;
          
          // Notification limitée
          if (reconnectAttemptsRef.current === 1 || reconnectAttemptsRef.current % 5 === 0) {
            showNotification("Connexion perdue. Tentative de reconnexion...", "error");
          }
          
          // Nettoyage du timer précédent si existe
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
          }
          
          // Planifier la reconnexion avec backoff exponentiel
          const delay = getReconnectDelay();
          reconnectTimerRef.current = setTimeout(connectWebSocket, delay);
        }
      };

      socket.onerror = (error) => {
        console.error("WebSocket Error:", error);
        // Éviter les notifications excessives pour les erreurs
        if (reconnectAttemptsRef.current === 0) {
          showNotification("Erreur de connexion", "error");
        }
      };

      socket.onmessage = (event) => {
        // Incrémenter le compteur de messages
        setMessageCount(prev => prev + 1);
        
        try {
          const parsedData = JSON.parse(event.data);
          
          // Gestion des alertes et messages système
          if (parsedData.alert) {
            showNotification(parsedData.alert);
            setStatusMessage(parsedData.alert);
            return;
          }
          
          if (parsedData.system) {
            showNotification(parsedData.message || "Message système reçu");
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
      showNotification("Impossible de se connecter au serveur", "error");
      isReconnectingRef.current = false;
      
      // Planifier une nouvelle tentative
      const delay = getReconnectDelay();
      reconnectTimerRef.current = setTimeout(connectWebSocket, delay);
    }
  };

  useEffect(() => {
    connectWebSocket();

    return () => {
      // Nettoyage
      isIntentionalDisconnectRef.current = true;
      
      if (wsRef.current) {
        wsRef.current.close();
      }
      
      if (samplingTimerRef.current) {
        clearInterval(samplingTimerRef.current);
      }
      
      if (displayRefreshTimerRef.current) {
        clearInterval(displayRefreshTimerRef.current);
      }
      
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [serverUrl]);

  // Fonction pour changer l'URL du serveur
  const handleServerUrlChange = (e) => {
    setServerUrl(e.target.value);
  };

  // Fonction pour se reconnecter manuellement
  const handleReconnect = () => {
    // Réinitialiser le compteur de tentatives pour la reconnexion manuelle
    reconnectAttemptsRef.current = 0;
    
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    
    connectWebSocket();
  };

  // Fonction pour effacer les données
  const handleClearData = () => {
    setChartData([]);
    chartDataFullRef.current = [];
    setTextData([]);
    setSensorValues({});
    dataBufferRef.current = {};
    setMessageCount(0);
    showNotification("Données effacées");
  };

  // Fonction pour envoyer un message test au serveur
  const handleTestMessage = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({type: "ping", timestamp: new Date().toISOString()}));
      showNotification("Message de test envoyé");
    } else {
      showNotification("WebSocket non connecté", "error");
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
              Statut: <span className={`font-semibold ${status.includes("Connecté") ? "text-green-400" : status.includes("cours") ? "text-yellow-400" : "text-red-400"}`}>{status}</span>
              {" "}<small>({messageCount} messages reçus)</small>
              {reconnectAttemptsRef.current > 0 && (
                <span className="ml-2 text-yellow-400">
                  Tentative {reconnectAttemptsRef.current}
                </span>
              )}
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
        <h2 className="text-xl font-semibold mb-4">
          📈 Graphiques en Temps Réel 
          <span className="text-sm font-normal ml-2 text-gray-400">(15 dernières secondes)</span>
        </h2>
        
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