import mimetypes
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import uvicorn

app = FastAPI(title="COUP - A Game of Deception")
BASE_DIR = Path(__file__).parent

NO_CACHE = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}
# SEO / icon assets are immutable enough to cache for a day in local dev.
ASSET_CACHE = {"Cache-Control": "public, max-age=86400"}

# Root-level files crawlers and browsers request directly. Served here for
# parity with the production (Vercel) static hosting.
ROOT_ASSETS = {
    "robots.txt", "sitemap.xml", "site.webmanifest",
    "favicon.svg", "favicon.png", "apple-touch-icon.png",
    "icon-192.png", "icon-512.png", "og-image.png",
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

@app.get("/{name}")
async def root_asset(name: str):
    if name not in ROOT_ASSETS:
        raise HTTPException(status_code=404)
    media_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    if name == "site.webmanifest":
        media_type = "application/manifest+json"
    return FileResponse(BASE_DIR / name, media_type=media_type, headers=ASSET_CACHE)

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
