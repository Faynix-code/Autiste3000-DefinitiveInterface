import asyncio
import websockets
import serial
import json

PORT = 8765  # Port WebSocket
PORT_SERIE = "COM3"  # Remplace par ton port réel
BAUD_RATE = 115200

async def envoyer_donnees(websocket):
    """Lit les données de la carte Micro:bit via USB et les envoie au client WebSocket."""
    try:
        ser = serial.Serial(PORT_SERIE, BAUD_RATE, timeout=1)
        print("✅ Micro:bit connecté !")
    except serial.SerialException:
        print("⚠️ Aucune Micro:bit détectée. En attente de connexion...")
        ser = None

    try:
        while True:
            if ser:
                ligne = ser.readline().decode("utf-8").strip()
                if ligne:
                    try:
                        name, value = ligne.split(",")
                        data = {"time": asyncio.get_event_loop().time(), name: float(value)}
                        await websocket.send(json.dumps(data))
                    except ValueError as e:
                        erreur = {"error": f"Erreur de conversion : {e}", "raw_data": ligne}
                        await websocket.send(json.dumps(erreur))
            else:
                await websocket.send(json.dumps({"status": "Micro:bit non détecté"}))
                await asyncio.sleep(2)  # Attend 2s avant de réessayer
    except websockets.exceptions.ConnectionClosed:
        print("❌ Client WebSocket déconnecté.")
    finally:
        if ser:
            ser.close()

async def start_server():
    """Démarre le serveur WebSocket."""
    server = await websockets.serve(envoyer_donnees, "0.0.0.0", PORT)
    print(f"✅ WebSocket en écoute sur ws://localhost:{PORT}")
    await server.wait_closed()

if __name__ == "__main__":
    asyncio.run(start_server())
