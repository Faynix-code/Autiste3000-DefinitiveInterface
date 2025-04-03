import asyncio
import serial
import serial.tools.list_ports
import websockets
import json
import threading

PORT = 8765  # Port WebSocket
SERIAL_BAUDRATE = 115200  # Vitesse de communication série

class MicrobitWebSocketServer:
    def __init__(self):
        self.serial_port = None
        self.websocket_clients = set()
        self.connected = False

    async def detect_microbit(self):
        """Détecte automatiquement la carte Micro:bit."""
        ports = serial.tools.list_ports.comports()
        for port in ports:
            if "Microbit" in port.description or "mbed" in port.description:
                return port.device
        return None

    def start_serial_thread(self):
        """Démarre la gestion du port série dans un thread séparé."""
        threading.Thread(target=self.manage_serial_connection, daemon=True).start()

    def manage_serial_connection(self):
        """Gère la connexion série dans un thread séparé."""
        while True:
            try:
                port = asyncio.run(self.detect_microbit())  # Attente correcte de la coroutine
                if port:
                    if not self.connected:
                        print(f"✅ Micro:bit détectée sur {port}")
                        self.serial_port = serial.Serial(port, SERIAL_BAUDRATE, timeout=1)
                        self.connected = True
                        print("🔌 Port série ouvert")
                        self.read_serial()
                    else:
                        print("⚠️ La Micro:bit est déjà connectée.")
                else:
                    print("⚠️ Aucune Micro:bit détectée...")
            except Exception as e:
                print(f"❌ Erreur de connexion série : {e}")
            asyncio.sleep(3)  # Vérifier toutes les 3 secondes

    def read_serial(self):
        """Lit les données de la Micro:bit et les envoie aux clients WebSocket."""
        while self.serial_port and self.serial_port.is_open:
            try:
                data = self.serial_port.readline().decode("utf-8").strip()
                if data:
                    print(f"📥 Reçu : {data}")
                    if "," in data:
                        name, value = data.split(",", 1)
                        try:
                            value = float(value)
                        except ValueError:
                            value = data  # Si la valeur n'est pas un nombre, la traiter comme une chaîne
                        
                        message = {"name": name, "value": value, "raw_data": data}
                        asyncio.run(self.broadcast(message))

                        # Gestion des alertes "status,1" et "status,2"
                        if name == "status":
                            if value == 1:
                                asyncio.run(self.broadcast({"alert": "L'autiste va bien 😊"}))
                            elif value == 2:
                                asyncio.run(self.broadcast({"alert": "L'autiste ne va pas bien 😟"}))

            except Exception as e:
                print(f"❌ Erreur de lecture série : {e}")
                break

    async def broadcast(self, message):
        """Envoie un message à tous les clients connectés."""
        if self.websocket_clients:
            try:
                msg_json = json.dumps(message)
                await asyncio.gather(*(client.send(msg_json) for client in self.websocket_clients))
            except websockets.exceptions.ConnectionClosedError as e:
                print(f"❌ Erreur de connexion WebSocket lors de l'envoi : {e}")
                await self.remove_closed_connections()

    async def websocket_handler(self, websocket):
        """Gère les connexions WebSocket."""
        print("🔗 Client connecté")
        self.websocket_clients.add(websocket)
        try:
            await websocket.wait_closed()
        except websockets.exceptions.ConnectionClosedError as e:
            print(f"❌ Erreur de connexion WebSocket : {e}")
        finally:
            self.websocket_clients.remove(websocket)
            print("❌ Client déconnecté")

    async def remove_closed_connections(self):
        """Supprime les connexions fermées des clients WebSocket."""
        self.websocket_clients = {client for client in self.websocket_clients if not client.closed}

    async def start_server(self):
        """Démarre le serveur WebSocket."""
        try:
            websocket_server = await websockets.serve(self.websocket_handler, "0.0.0.0", PORT)
            print(f"✅ WebSocket en écoute sur ws://localhost:{PORT}")

            # Démarrer la gestion de la Micro:bit dans un thread
            self.start_serial_thread()

            await websocket_server.wait_closed()

        except Exception as e:
            print(f"❌ Erreur de serveur WebSocket : {e}")

if __name__ == "__main__":
    server = MicrobitWebSocketServer()
    loop = asyncio.get_event_loop()
    try:
        loop.run_until_complete(server.start_server())
    except KeyboardInterrupt:
        print("\n🛑 Serveur arrêté manuellement.")
    finally:
        loop.close()
