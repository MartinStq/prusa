import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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
    import RFB from '/api/slicer/novnc/core/rfb.js';

    const screenEl = document.getElementById('screen');
    const overlayEl = document.getElementById('overlay');
    let rfb = null;
    let reconnectTimer = null;
    let useFallbackPort = false;

    function connect() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = useFallbackPort
        ? proto + '://' + window.location.hostname + ':6098/websockify'
        : proto + '://' + window.location.host + '/slicer-ws';

      try {
        rfb = new RFB(screenEl, wsUrl);
        rfb.scaleViewport = true;
        rfb.resizeSession = true;
        rfb.clipViewport = false;
        rfb.showDotCursor = false;
        rfb.background = '#0f172a';

        rfb.addEventListener('connect', () => {
          overlayEl.classList.add('hidden');
        });

        rfb.addEventListener('disconnect', () => {
          useFallbackPort = !useFallbackPort;
          overlayEl.textContent = 'Connexion au flux PrusaSlicer…';
          overlayEl.classList.remove('hidden');
          reconnectTimer = setTimeout(connect, 900);
        });
      } catch (err) {
        useFallbackPort = !useFallbackPort;
        reconnectTimer = setTimeout(connect, 900);
      }
    }

    connect();
  </script>
</body>
</html>`;

export async function GET() {
  return new NextResponse(EMBED_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
