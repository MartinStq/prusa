import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import next from "next";
import { WebSocketServer } from "ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);
const VNC_PORT = 5998;

const novncRoot = path.resolve(process.cwd(), "node_modules", "@novnc", "novnc");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

const EMBED_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>PrusaSlicer Intégré</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #0f172a;
      font-family: system-ui, -apple-system, sans-serif;
      user-select: none;
    }
    #screen {
      width: 100%;
      height: 100%;
    }
    #overlay {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.88);
      color: #e2e8f0;
      font-size: 13px;
      letter-spacing: 0.01em;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    #overlay.hidden {
      opacity: 0;
    }
  </style>
</head>
<body>
  <div id="screen"></div>
  <div id="overlay">Connexion à PrusaSlicer…</div>
  <script type="module">
    import RFB from '/slicer-novnc/core/rfb.js';

    const screenEl = document.getElementById('screen');
    const overlayEl = document.getElementById('overlay');
    let rfb = null;
    let reconnectTimer = null;

    function connect() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = proto + '://' + window.location.host + '/slicer-ws';

      try {
        rfb = new RFB(screenEl, wsUrl);
        rfb.scaleViewport = true;
        rfb.resizeSession = true;
        rfb.clipViewport = false;
        rfb.showDotCursor = false;
        // Encodage Tight/JPEG rapide (libjpeg-turbo) : ~35 Ko/image au lieu de 3.4 Mo brut -> 0 latence souris
        rfb.compressionLevel = 1;
        rfb.qualityLevel = 5;
        rfb.background = '#0f172a';

        rfb.addEventListener('connect', () => {
          overlayEl.classList.add('hidden');
        });

        rfb.addEventListener('disconnect', () => {
          overlayEl.textContent = 'Reconnexion à PrusaSlicer…';
          overlayEl.classList.remove('hidden');
          reconnectTimer = setTimeout(connect, 1500);
        });
      } catch (err) {
        reconnectTimer = setTimeout(connect, 1500);
      }
    }

    connect();
  </script>
</body>
</html>`;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();
const upgradeHandler = app.getUpgradeHandler();

const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols) =>
    protocols.has("binary") ? "binary" : false,
});

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  if (urlPath === "/slicer-embed") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(EMBED_HTML);
    return;
  }

  if (urlPath.startsWith("/slicer-novnc/")) {
    const relPath = urlPath.slice("/slicer-novnc/".length);
    const absPath = path.resolve(novncRoot, relPath);
    if (!absPath.startsWith(novncRoot + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    try {
      const content = await fs.readFile(absPath);
      const ext = path.extname(absPath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      });
      res.end(content);
      return;
    } catch {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
  }

  handle(req, res);
});

server.on("upgrade", (req, socket, head) => {
  const urlPath = (req.url || "").split("?")[0];

  if (urlPath === "/slicer-ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const vncSocket = net.createConnection({
        host: "127.0.0.1",
        port: VNC_PORT,
      });

      vncSocket.on("data", (chunk) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(chunk, { binary: true });
        }
      });

      ws.on("message", (data) => {
        if (!vncSocket.destroyed) {
          if (Buffer.isBuffer(data)) {
            vncSocket.write(data);
          } else if (data instanceof ArrayBuffer) {
            vncSocket.write(Buffer.from(data));
          } else if (Array.isArray(data)) {
            vncSocket.write(Buffer.concat(data));
          }
        }
      });

      const cleanup = () => {
        if (!vncSocket.destroyed) vncSocket.destroy();
        if (
          ws.readyState === ws.OPEN ||
          ws.readyState === ws.CONNECTING
        ) {
          ws.close();
        }
      };

      vncSocket.on("close", cleanup);
      vncSocket.on("error", cleanup);
      ws.on("close", cleanup);
      ws.on("error", cleanup);
    });
    return;
  }

  upgradeHandler(req, socket, head);
});

// Timeout généreux (15 min) pour les gros fichiers .stl et les longs transferts Wi-Fi .bgcode vers la Prusa
server.requestTimeout = 15 * 60 * 1000;
server.headersTimeout = 60 * 1000;
server.keepAliveTimeout = 65 * 1000;

server.listen(port, () => {
  console.log(`> Prusa Pilot prêt sur http://${hostname}:${port}`);
});
