from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import uvicorn

app = FastAPI(title="COUP — A Game of Deception")
BASE_DIR = Path(__file__).parent

NO_CACHE = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}

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

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
