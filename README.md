# Prusa Pilot 3D — Console Opérateur Locale

Application web locale (Next.js App Router, TypeScript, Tailwind CSS, Prisma + SQLite) pour piloter un service d'impression 3D **PLA** sur une **Prusa MK4 / MK4S** connectée en Wi-Fi via **PrusaLink**, compatible **100 % Windows natif (zéro droit administrateur, zéro WSL)** et **Linux**.

## Fonctionnalités principales

- **Architecture prête pour Odoo** : toute la logique métier est isolée dans `src/services/orders.ts`.
- **Inspection 3D + vrai PrusaSlicer** :
  - **Sur Windows (100 % natif, 60 FPS GPU)** : viewer 3D WebGL interactif au centre + bouton **« Ouvrir dans PrusaSlicer »** qui lance le vrai `prusa-slicer.exe` (préconfiguré sur `Original Prusa MK4S 0.4 nozzle bon` + `Prusament PLA @MK4S`).
  - **Sur Linux** : le vrai PrusaSlicer intégré directement dans l'onglet.
- **Synchronisation automatique poids & prix TVAC** : dès que vous cliquez sur *Exporter le G-code* (`Entrée`) dans PrusaSlicer, le poids PLA exact et le prix TVAC (`(g × 0,20) + 10 €`) se remplissent automatiquement à droite.
- **PrusaLink Wi-Fi + notifications temps réel** : envoi direct des gros `.bgcode`/`.gcode` (Digest Auth en 1 passe, timeout 10 min) + alertes sonores, bannière, cloche et titre d'onglet en cas de changement de filament (`ATTENTION`), pause (`PAUSED`), arrêt (`STOPPED`) ou erreur (`ERROR`).
- **Configuration PrusaLink dans l'interface** : bouton **⚙️** en haut à droite pour régler l'IP et le mot de passe sans éditer `.env`.

---

## Installation 100 % Windows (zéro WSL, zéro droit admin)

1. Téléchargez le dépôt sur le PC Windows (**Code → Download ZIP** puis **clic droit sur le ZIP → Extraire tout…**, ou via `git clone https://github.com/MartinStq/prusa.git`).
2. **Méthode rapide :** ouvrez le dossier `windows\` et double-cliquez sur **`1-Installer-sur-Windows.bat`**.
3. **Si Windows 10 affiche *« Cette application ne peut pas s'exécuter sur votre PC »* sur le `.bat` :**
   - Ouvrez le dossier décompressé `prusa`.
   - Cliquez dans la **barre d'adresse en haut de l'Explorateur Windows**, tapez **`powershell`** puis appuyez sur **`Entrée`**.
   - Collez cette commande et appuyez sur **`Entrée`** :
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .\windows\1-Installer-sur-Windows.ps1
     ```
4. L'installateur télécharge automatiquement **Node.js 20 portable** (`vendor\node\`) et **PrusaSlicer Windows portable** (`vendor\prusaslicer\`), installe votre profil **Original Prusa MK4S 0.4 nozzle bon** + **Prusament PLA**, initialise SQLite, compile le site et crée **`Lancer-Prusa-Pilot.bat`** sur le Bureau.
5. **Pour lancer au quotidien :**
   - Double-cliquez sur **`Lancer-Prusa-Pilot.bat`** sur votre Bureau.
   - *(Ou dans PowerShell ouvert dans le dossier `prusa`, si les `.bat` sont bloqués :)*
     ```powershell
     $env:Path = "$PWD\vendor\node;$env:Path"; Start-Process "http://localhost:3000"; node server.mjs --prod
     ```

---

## Installation sur Linux (Ubuntu / Debian)

```bash
git clone https://github.com/MartinStq/prusa.git
cd prusa
cp .env.example .env   # puis renseignez PRUSA_IP et PRUSA_API_KEY
chmod +x scripts/setup-wsl.sh
./scripts/setup-wsl.sh
npm start
```

Ouvrez ensuite **http://localhost:3000**.
