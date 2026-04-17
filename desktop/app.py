"""
Depth Scanner OSS — Desktop Application
Standalone depth map generator powered by Depth Anything V2.
No After Effects required.

Usage:
    python app.py
"""

import os
import sys
import threading
import time

# Add backend to path so we can import its modules
BACKEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
sys.path.insert(0, BACKEND_DIR)

import webview
import uvicorn
from fastapi.staticfiles import StaticFiles
from server import app as fastapi_app

SERVER_HOST = "127.0.0.1"
SERVER_PORT = 7843
DESKTOP_DIR = os.path.dirname(os.path.abspath(__file__))
UI_PATH = os.path.join(DESKTOP_DIR, "ui.html")


def start_server():
    uvicorn.run(fastapi_app, host=SERVER_HOST, port=SERVER_PORT, log_level="warning")


def main():
    # Prepare UI HTML with server URL baked in
    with open(UI_PATH, "r") as f:
        html = f.read()
    html = html.replace("__SERVER_URL__", f"http://{SERVER_HOST}:{SERVER_PORT}")

    served_path = os.path.join(DESKTOP_DIR, "_app.html")
    with open(served_path, "w") as f:
        f.write(html)

    # Mount desktop dir as static files so FastAPI serves the HTML
    fastapi_app.mount("/app", StaticFiles(directory=DESKTOP_DIR, html=True), name="desktop")

    # Start server in background
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # Wait for server to be ready
    import urllib.request
    for _ in range(30):
        try:
            urllib.request.urlopen(f"http://{SERVER_HOST}:{SERVER_PORT}/health", timeout=1)
            break
        except Exception:
            time.sleep(0.5)

    # Open native window pointing at HTTP URL (not file://)
    window = webview.create_window(
        "Depth Scanner OSS",
        url=f"http://{SERVER_HOST}:{SERVER_PORT}/app/_app.html",
        width=1100,
        height=760,
        min_size=(900, 600),
        background_color="#1a1a1c",
    )

    webview.start(gui="cocoa")

    # Cleanup
    try:
        os.unlink(served_path)
    except OSError:
        pass


if __name__ == "__main__":
    main()
