#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "=========================================="
echo " Installation Prusa Pilot 3D (WSL2/Linux)"
echo "=========================================="

echo "[1/5] Installation des paquets système (Xtigervnc, xdotool, libs GTK3/GL)..."
sudo apt-get update
sudo apt-get install -y \
  git curl ca-certificates bzip2 xz-utils \
  tigervnc-standalone-server xdotool x11-utils x11-xserver-utils \
  libgtk-3-0 libglu1-mesa libgl1 libegl1 libgomp1 libsecret-1-0 \
  libxkbcommon0 libwayland-client0 libdbus-1-3 fonts-dejavu-core

# WebKit2GTK (nom différent entre Ubuntu 22.04 et 24.04)
sudo apt-get install -y libwebkit2gtk-4.1-0 2>/dev/null || \
  sudo apt-get install -y libwebkit2gtk-4.0-37 2>/dev/null || true

echo "[2/5] Vérification de Node.js 20+..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node.js $(node -v) / npm $(npm -v)"

echo "[3/5] Installation du vrai PrusaSlicer 2.9+ dans ./vendor/prusaslicer/..."
mkdir -p "$PROJECT_DIR/vendor/prusaslicer"
if [ ! -x "$PROJECT_DIR/vendor/prusaslicer/prusa-slicer" ] && [ ! -x "$PROJECT_DIR/vendor/prusaslicer/bin/prusa-slicer" ]; then
  DOWNLOAD_URL="$(curl -fsSL https://api.github.com/repos/prusa3d/PrusaSlicer/releases/latest | node -e '
    let d = "";
    process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => {
      const r = JSON.parse(d);
      const assets = r.assets || [];
      const tarAsset = assets.find(a => /linux-x64.*GTK3.*\.tar\.bz2$/i.test(a.name))
        || assets.find(a => /linux-x64.*\.tar\.bz2$/i.test(a.name));
      const appImage = assets.find(a => /linux-x64.*GTK3.*\.AppImage$/i.test(a.name))
        || assets.find(a => /linux-x64.*\.AppImage$/i.test(a.name));
      console.log((tarAsset || appImage || {}).browser_download_url || "");
    });
  ')"

  if [ -n "$DOWNLOAD_URL" ]; then
    echo "Téléchargement : $DOWNLOAD_URL"
    TMP_ARCHIVE="/tmp/prusaslicer_dl"
    curl -fL "$DOWNLOAD_URL" -o "$TMP_ARCHIVE"

    if [[ "$DOWNLOAD_URL" == *.tar.bz2 ]]; then
      tar -xjf "$TMP_ARCHIVE" -C "$PROJECT_DIR/vendor/prusaslicer" --strip-components=1
    else
      chmod +x "$TMP_ARCHIVE"
      (cd "$PROJECT_DIR/vendor/prusaslicer" && "$TMP_ARCHIVE" --appimage-extract >/dev/null)
      ln -sf "$PROJECT_DIR/vendor/prusaslicer/squashfs-root/usr/bin/prusa-slicer" "$PROJECT_DIR/vendor/prusaslicer/prusa-slicer"
    fi
    rm -f "$TMP_ARCHIVE"
  else
    echo "Fallback apt : installation de prusa-slicer..."
    sudo apt-get install -y prusa-slicer
  fi
fi

echo "[4/5] Copie du profil imprimante personnalisé (Original Prusa MK4S 0.4 nozzle bon)..."
mkdir -p "$HOME/.config/PrusaSlicer/printer"
if [ -f "$PROJECT_DIR/config/prusaslicer/printer/Original Prusa MK4S 0.4 nozzle bon.ini" ]; then
  cp "$PROJECT_DIR/config/prusaslicer/printer/Original Prusa MK4S 0.4 nozzle bon.ini" \
     "$HOME/.config/PrusaSlicer/printer/"
fi

if [ ! -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
  echo "⚠ Fichier .env créé depuis .env.example — vérifiez PRUSA_IP et PRUSA_API_KEY."
fi

echo "[5/5] Dépendances npm, base SQLite et build de production..."
npm install
npx prisma migrate deploy
if [ ! -f "$PROJECT_DIR/prisma/dev.db" ] || [ ! -s "$PROJECT_DIR/prisma/dev.db" ]; then
  npm run db:seed
fi
npm run build

echo ""
echo "✓ Installation terminée ! Lancez avec : npm start"
echo "  Puis ouvrez http://localhost:3000 dans votre navigateur Windows."
