from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from pydantic import BaseModel
from typing import Dict
import uvicorn
import json
import random
import string

app = FastAPI(title="COUP — A Game of Deception")
BASE_DIR = Path(__file__).parent

NO_CACHE = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}

# --- Lobby management ---
lobbies: Dict[str, dict] = {}


def gen_code():
    while True:
        code = ''.join(random.choices(string.ascii_uppercase, k=4))
        if code not in lobbies:
            return code


class ConnectionManager:
    def __init__(self):
        self.active: Dict[str, Dict[int, WebSocket]] = {}

    async def connect(self, ws: WebSocket, code: str, pid: int):
        await ws.accept()
        if code not in self.active:
            self.active[code] = {}
        self.active[code][pid] = ws

    def disconnect(self, code: str, pid: int):
        if code in self.active:
            self.active[code].pop(pid, None)
            if not self.active[code]:
                del self.active[code]

    async def send(self, code: str, pid: int, msg: dict):
        ws = self.active.get(code, {}).get(pid)
        if ws:
            try:
                await ws.send_text(json.dumps(msg))
            except Exception:
                pass

    async def broadcast(self, code: str, msg: dict, exclude: int = None):
        for pid, ws in list(self.active.get(code, {}).items()):
            if pid != exclude:
                try:
                    await ws.send_text(json.dumps(msg))
                except Exception:
                    pass


manager = ConnectionManager()

app.mount("/static", StaticFiles(directory=BASE_DIR), name="static")


@app.get("/")
async def index():
    return FileResponse(BASE_DIR / "index.html", headers=NO_CACHE)


@app.get("/style.css")
async def styles():
    return FileResponse(BASE_DIR / "style.css", media_type="text/css", headers=NO_CACHE)


@app.get("/game.js")
async def game():
    return FileResponse(BASE_DIR / "game.js", media_type="application/javascript", headers=NO_CACHE)


class CreateBody(BaseModel):
    name: str = "Player 1"


class JoinBody(BaseModel):
    name: str = ""


@app.post("/lobby/create")
async def create_lobby(body: CreateBody):
    name = body.name.strip()[:20] or "Player 1"
    code = gen_code()
    lobbies[code] = {
        "code": code,
        "players": [{"id": 0, "name": name}],
        "started": False,
    }
    return {"code": code, "playerId": 0}


@app.post("/lobby/join/{code}")
async def join_lobby(code: str, body: JoinBody):
    code = code.upper()
    lobby = lobbies.get(code)
    if not lobby:
        return JSONResponse({"error": "Lobby not found"}, status_code=404)
    if lobby["started"]:
        return JSONResponse({"error": "Game already started"}, status_code=400)
    if len(lobby["players"]) >= 4:
        return JSONResponse({"error": "Lobby is full"}, status_code=400)
    name = body.name.strip()[:20] or f"Player {len(lobby['players']) + 1}"
    pid = len(lobby["players"])
    lobby["players"].append({"id": pid, "name": name})
    await manager.broadcast(code, {"type": "player_joined", "players": lobby["players"]})
    return {"playerId": pid, "players": lobby["players"], "code": code}


@app.get("/lobby/{code}")
async def get_lobby(code: str):
    lobby = lobbies.get(code.upper())
    if not lobby:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return {"players": lobby["players"], "started": lobby["started"]}


@app.websocket("/ws/{code}/{player_id}")
async def ws_endpoint(websocket: WebSocket, code: str, player_id: int):
    code = code.upper()
    lobby = lobbies.get(code)
    if not lobby:
        await websocket.close(1008)
        return

    await manager.connect(websocket, code, player_id)

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            msg["from"] = player_id
            to = msg.get("to")
            if to is not None:
                await manager.send(code, int(to), msg)
            else:
                await manager.broadcast(code, msg, exclude=player_id)
    except WebSocketDisconnect:
        manager.disconnect(code, player_id)
        if not manager.active.get(code):
            lobbies.pop(code, None)
        else:
            await manager.broadcast(code, {"type": "player_left", "playerId": player_id})


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
