import asyncio
import serial
import serial.tools.list_ports
import websockets
import json
import threading
import queue
import time
import sys
import platform

PORT = 8765  # Port WebSocket
SERIAL_BAUDRATE = 115200  # Vitesse de communication série

class MicrobitWebSocketServer:
    def __init__(self):
        self.serial_port = None
        self.websocket_clients = set()
        self.connected = False
        self.message_queue = queue.Queue()  # File pour partager les données entre threads
        self.running = True
        self.os_name = platform.system()  # Détection du système d'exploitation
        print(f"Système d'exploitation détecté: {self.os_name}")

    def detect_microbit(self):
        """Détecte automatiquement la carte Micro:bit de manière compatible entre Linux et Windows."""
        ports = list(serial.tools.list_ports.comports())
        
        # Critères de détection par système d'exploitation
        if self.os_name == "Windows":
            # Sur Windows, chercher "mbed" ou "Microbit" dans la description
            for port in ports:
                if any(keyword.lower() in port.description.lower() for keyword in ["microbit", "mbed"]):
                    print(f"Micro:bit détectée sur Windows: {port.device} ({port.description})")
                    return port.device
        
        elif self.os_name == "Linux":
            # Sur Linux, on cherche d'abord les identifiants VID:PID de la Micro:bit
            # VID:PID courants pour Micro:bit : 0d28:0204 (BBC Microbit)
            for port in ports:
                if hasattr(port, 'vid') and hasattr(port, 'pid'):
                    if port.vid == 0x0d28 and port.pid == 0x0204:
                        print(f"Micro:bit détectée sur Linux avec VID:PID: {port.device}")
                        return port.device
            
            # Méthode alternative sur Linux : recherche par mots-clés dans le nom du port
            for port in ports:
                if any(keyword in port.device.lower() for keyword in ["ttyacm", "ttyusb"]):
                    if any(keyword.lower() in (port.description or "").lower() for keyword in ["microbit", "mbed"]):
                        print(f"Micro:bit détectée sur Linux avec description: {port.device}")
                        return port.device
        
        # Si aucun port trouvé, afficher la liste des ports disponibles pour le débogage
        print("Ports disponibles:")
        for port in ports:
            print(f" - {port.device}: {port.description}")
            
        return None

    def start_serial_thread(self):
        """Démarre la gestion du port série dans un thread séparé."""
        threading.Thread(target=self.manage_serial_connection, daemon=True).start()

    def manage_serial_connection(self):
        """Gère la connexion série dans un thread séparé."""
        reconnect_delay = 3  # Délai initial de reconnexion en secondes
        max_reconnect_delay = 30  # Délai maximum de reconnexion
        
        while self.running:
            try:
                port = self.detect_microbit()
                if port:
                    if not self.connected:
                        print(f"✅ Micro:bit détectée sur {port}")
                        try:
                            # Paramètres adaptés à Windows et Linux
                            self.serial_port = serial.Serial(
                                port=port,
                                baudrate=SERIAL_BAUDRATE,
                                timeout=1,
                                write_timeout=1,
                                exclusive=False if self.os_name == "Windows" else True
                            )
                            self.connected = True
                            print("🔌 Port série ouvert")
                            
                            # Envoi de message de confirmation de connexion
                            self.message_queue.put({"system": True, "message": f"Micro:bit connectée sur {port}"})
                            
                            # Données d'exemple pour tester le frontend si nécessaire
                            # Décommenter pour envoyer des données de test
                            self.message_queue.put({"name": "temp", "value": 22.5, "raw_data": "temp,22.5"})
                            time.sleep(0.5)
                            self.message_queue.put({"name": "light", "value": 67, "raw_data": "light,67"})
                            
                            reconnect_delay = 3  # Réinitialisation du délai de reconnexion
                            self.read_serial()  # Cette fonction est bloquante jusqu'à déconnexion
                        except serial.SerialException as e:
                            print(f"❌ Erreur d'ouverture du port série : {e}")
                            time.sleep(1)  # Court délai avant de réessayer
                    else:
                        # Déjà connecté, vérification de l'état
                        if self.serial_port and not self.serial_port.is_open:
                            print("⚠️ Port série fermé de manière inattendue")
                            self.connected = False
                            if self.serial_port:
                                try:
                                    self.serial_port.close()
                                except:
                                    pass
                                self.serial_port = None
                else:
                    print(f"⚠️ Aucune Micro:bit détectée... Nouvelle tentative dans {reconnect_delay}s")
                    
                    # Si aucune Micro:bit n'est trouvée, envoyer un message de simulation pour tester le frontend
                    if self.websocket_clients:
                        # Envoi d'un message simulé toutes les 5 secondes quand aucune Micro:bit n'est connectée
                        if time.time() % 5 < 0.1:  # Pour éviter d'envoyer trop de messages
                            import random
                            self.message_queue.put({
                                "name": "simulated", 
                                "value": random.uniform(0, 100), 
                                "raw_data": "simulated," + str(random.uniform(0, 100))
                            })
            except Exception as e:
                print(f"❌ Erreur de connexion série : {e}")
                self.connected = False
                if self.serial_port and self.serial_port.is_open:
                    try:
                        self.serial_port.close()
                    except:
                        pass
                    self.serial_port = None
            
            # Implémentation d'un délai de reconnexion exponentiel
            time.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 1.5, max_reconnect_delay)

    def read_serial(self):
        """Lit les données de la Micro:bit et les ajoute à la file d'attente."""
        read_error_count = 0
        max_errors = 5
        
        while self.serial_port and self.serial_port.is_open and self.running and read_error_count < max_errors:
            try:
                # Adaptation pour fonctionner sur Windows et Linux
                if self.os_name == "Windows":
                    # Sur Windows, vérifier les données en attente
                    if self.serial_port.in_waiting > 0:
                        data = self.serial_port.readline().decode("utf-8").strip()
                        if self.process_data(data):
                            read_error_count = 0  # Réinitialiser le compteur d'erreurs en cas de succès
                else:
                    # Sur Linux, utiliser une approche avec timeout
                    data = self.serial_port.readline().decode("utf-8").strip()
                    if data:
                        if self.process_data(data):
                            read_error_count = 0
                
                # Courte pause pour éviter d'utiliser trop de CPU
                time.sleep(0.01)
                
            except UnicodeDecodeError:
                # Ignorer les erreurs de décodage, peut arriver avec des données incomplètes
                pass
            except serial.SerialException as e:
                read_error_count += 1
                print(f"❌ Erreur de lecture série ({read_error_count}/{max_errors}): {e}")
                time.sleep(0.1)  # Pause courte avant de réessayer
            except Exception as e:
                read_error_count += 1
                print(f"❌ Erreur inattendue dans read_serial ({read_error_count}/{max_errors}): {e}")
                time.sleep(0.1)
        
        # Si on sort de la boucle, réinitialiser l'état de connexion
        print("⚠️ Fin de la lecture série")
        self.connected = False
        if self.serial_port and self.serial_port.is_open:
            try:
                self.serial_port.close()
            except:
                pass
            self.serial_port = None

    def process_data(self, data):
        """Traite les données reçues et les met dans la file d'attente."""
        if not data:
            return False
            
        print(f"📥 Reçu : {data}")
        
        if ":" in data:
            try:
                name, value = data.split(":", 1)
                try:
                    value = float(value)
                except ValueError:
                    value = value  # Si la valeur n'est pas un nombre, la traiter comme une chaîne
                
                message = {"name": name, "value": value, "raw_data": data}
                self.message_queue.put(message)
                print(f"✅ Données traitées: {name}={value}")

                # Gestion des alertes "status,1" et "status,2"
                if name == "status":
                    if value == 1:
                        self.message_queue.put({"alert": "L'autiste va bien 😊"})
                    elif value == 2:
                        self.message_queue.put({"alert": "L'autiste ne va pas bien 😟"})
                return True
            except Exception as e:
                print(f"❌ Erreur de traitement des données : {e}")
        else:
            # Même si le format n'est pas correct, envoyer quand même un message
            # pour que le frontend puisse voir qu'il y a de l'activité
            self.message_queue.put({"raw_text": data})
        return False

    async def broadcast(self, message):
        """Envoie un message à tous les clients connectés."""
        if self.websocket_clients:
            try:
                msg_json = json.dumps(message)
                await asyncio.gather(*(client.send(msg_json) for client in self.websocket_clients))
                print(f"📤 Envoyé à {len(self.websocket_clients)} clients : {msg_json}")
                return True
            except Exception as e:
                print(f"❌ Erreur de connexion WebSocket lors de l'envoi : {e}")
                await self.remove_closed_connections()
                return False
        return False

    async def process_queue(self):
        """Traite les messages en attente dans la file d'attente."""
        while self.running:
            try:
                # Vérifier s'il y a des messages dans la file d'attente sans bloquer
                if not self.message_queue.empty():
                    message = self.message_queue.get_nowait()
                    success = await self.broadcast(message)
                    if not success and 'system' not in message:
                        # Si l'envoi échoue et que ce n'est pas un message système,
                        # remettre dans la queue pour réessayer plus tard
                        self.message_queue.put(message)
                await asyncio.sleep(0.1)  # Petite pause pour ne pas surcharger la CPU
            except queue.Empty:
                pass  # La file est vide, c'est normal
            except Exception as e:
                print(f"❌ Erreur dans le traitement de la file d'attente : {e}")

    async def websocket_handler(self, websocket):
        """Gère les connexions WebSocket."""
        remote = websocket.remote_address if hasattr(websocket, 'remote_address') else 'inconnu'
        print(f"🔗 Client connecté depuis {remote}")
        self.websocket_clients.add(websocket)
        
        # Envoyer un message de bienvenue
        welcome_msg = {"system": True, "message": "Connexion établie avec le serveur"}
        try:
            await websocket.send(json.dumps(welcome_msg))
            
            # Envoyer l'état de la Micro:bit
            if self.connected:
                await websocket.send(json.dumps({
                    "system": True,
                    "message": "Micro:bit connectée et prête"
                }))
            else:
                await websocket.send(json.dumps({
                    "system": True,
                    "message": "En attente de connexion à une Micro:bit"
                }))
                
            # Écouter les messages venant du client
            async for message in websocket:
                try:
                    data = json.loads(message)
                    print(f"📩 Message reçu du client: {data}")
                    
                    # Traiter les messages du client (si nécessaire)
                    if data.get('type') == 'ping':
                        await websocket.send(json.dumps({
                            "system": True,
                            "message": "Pong",
                            "timestamp": data.get('timestamp')
                        }))
                    
                except json.JSONDecodeError:
                    print(f"❌ Message non-JSON reçu: {message}")
                except Exception as e:
                    print(f"❌ Erreur de traitement du message client: {e}")
                    
        except websockets.exceptions.ConnectionClosedError as e:
            print(f"❌ Erreur de connexion WebSocket : {e}")
        except Exception as e:
            print(f"❌ Erreur inattendue dans le gestionnaire WebSocket: {e}")
        finally:
            self.websocket_clients.remove(websocket)
            print(f"❌ Client déconnecté : {remote}")

    async def remove_closed_connections(self):
        """Supprime les connexions fermées des clients WebSocket."""
        before = len(self.websocket_clients)
        self.websocket_clients = {client for client in self.websocket_clients if not client.closed}
        after = len(self.websocket_clients)
        if before != after:
            print(f"🧹 Nettoyage : {before - after} connexions fermées ont été supprimées")

    async def heartbeat(self):
        """Envoie périodiquement un message pour vérifier que la connexion est toujours active."""
        while self.running:
            if self.websocket_clients:
                await self.broadcast({
                    "system": True, 
                    "heartbeat": True, 
                    "timestamp": time.time()
                })
            await asyncio.sleep(30)  # Envoyer un heartbeat toutes les 30 secondes

    async def start_server(self):
        """Démarre le serveur WebSocket."""
        try:
            # Création du serveur WebSocket
            websocket_server = await websockets.serve(
                self.websocket_handler, 
                "0.0.0.0", 
                PORT, 
                ping_interval=30,  # Envoyer un ping toutes les 30 secondes
                ping_timeout=10    # Attendre 10 secondes pour un pong
            )
            
            print(f"✅ WebSocket en écoute sur ws://localhost:{PORT}")
            print(f"✅ Également accessible via l'adresse IP locale")

            # Démarrer la gestion de la Micro:bit dans un thread
            self.start_serial_thread()
            
            # Démarrer le traitement de la file d'attente
            queue_task = asyncio.create_task(self.process_queue())
            
            # Démarrer une tâche périodique pour nettoyer les connexions fermées
            async def periodic_cleanup():
                while self.running:
                    await self.remove_closed_connections()
                    await asyncio.sleep(60)  # Exécution toutes les minutes
            
            cleanup_task = asyncio.create_task(periodic_cleanup())
            
            # Démarrer le heartbeat
            heartbeat_task = asyncio.create_task(self.heartbeat())

            # Attendre que le serveur soit fermé
            await websocket_server.wait_closed()

        except Exception as e:
            print(f"❌ Erreur de serveur WebSocket : {e}")
        finally:
            self.running = False
            # S'assurer que toutes les tâches sont nettoyées
            tasks = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
            for task in tasks:
                task.cancel()

if __name__ == "__main__":
    # Afficher des informations sur l'environnement au démarrage
    print(f"Python {sys.version} sur {platform.system()} {platform.release()}")
    print(f"Librairie Serial: {serial.__version__}, WebSockets: {websockets.__version__}")
    
    server = MicrobitWebSocketServer()
    loop = asyncio.get_event_loop()
    
    # Gérer l'arrêt propre du serveur
    def signal_handler():
        print("\n🛑 Signal d'arrêt reçu")
        server.running = False
        for task in asyncio.all_tasks(loop):
            task.cancel()
    
    # Configurer la gestion des signaux selon l'OS
    if platform.system() != "Windows":
        import signal
        loop.add_signal_handler(signal.SIGINT, signal_handler)
        loop.add_signal_handler(signal.SIGTERM, signal_handler)
    
    try:
        loop.run_until_complete(server.start_server())
    except KeyboardInterrupt:
        print("\n🛑 Serveur arrêté manuellement.")
        server.running = False
    except asyncio.CancelledError:
        pass
    finally:
        if server.serial_port and server.serial_port.is_open:
            server.serial_port.close()
            print("🔌 Port série fermé")
        
        # Fermeture propre
        try:
            pending = asyncio.all_tasks(loop)
            loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        except:
            pass
        finally:
            loop.close()
            print("👋 Serveur arrêté")