# Prusa Pilot 3D — Console Opérateur Locale

Application web locale (Next.js App Router, TypeScript, Tailwind CSS, Prisma + SQLite) pour piloter un service d'impression 3D **PLA** sur une **Prusa MK4 / MK4S** connectée en Wi-Fi via **PrusaLink**, avec **le vrai PrusaSlicer intégré directement dans l'onglet du navigateur**.

## Fonctionnalités principales

- **Architecture prête pour Odoo** : toute la logique métier est isolée dans `src/services/orders.ts`.
- **Vrai PrusaSlicer 2.9 intégré au centre de la page** : chargement automatique du `.stl` sélectionné, profil par défaut `Original Prusa MK4S 0.4 nozzle bon` + `Prusament PLA @MK4S`.
- **Synchronisation automatique poids & prix TVAC** : dès que vous cliquez sur *Exporter le G-code* dans PrusaSlicer, le poids PLA exact et le prix TVAC (`(g × 0,20) + 10 €`) se remplissent automatiquement à droite.
- **PrusaLink Wi-Fi + notifications temps réel** : envoi direct des gros `.bgcode`/`.gcode` (Digest Auth en 1 passe, timeout 10 min) + alertes sonores, bannière, cloche et titre d'onglet en cas de changement de filament (`ATTENTION`), pause (`PAUSED`), arrêt (`STOPPED`) ou erreur (`ERROR`).
- **Mode test intégré** : menu *Simuler* en haut pour ajouter 1 ou 3 demandes clients de test ou tout supprimer.

---

## Installation sur Windows 10 / 11 (avec PrusaSlicer intégré dans l'onglet)

Grâce à **WSL2 (Ubuntu intégré à Windows)**, l'application offre exactement la même interface avec le vrai PrusaSlicer dans Chrome / Edge / Brave sur `http://localhost:3000` :

1. Clonez (ou téléchargez en ZIP) ce dépôt sur le PC Windows :
   ```powershell
   git clone https://github.com/MartinStq/prusa.git
   ```
2. Ouvrez le dossier `windows\` :
   - Faites un clic droit sur **`1-Installer-sur-Windows.ps1`** → **Exécuter avec PowerShell**.
   - *(Si WSL2/Ubuntu n'est pas encore installé sur Windows, le script l'installe automatiquement — redémarrez le PC une fois si Windows le demande, ouvrez Ubuntu une fois pour définir un identifiant/mot de passe, puis relancez le script.)*
   - Saisissez l'IP (`192.168.0.17`) et le mot de passe PrusaLink quand le script le demande.
3. Un raccourci **`Lancer-Prusa-Pilot.bat`** est créé automatiquement sur votre **Bureau Windows** :
   - Double-cliquez dessus chaque jour pour démarrer le serveur et ouvrir **http://localhost:3000** dans votre navigateur !

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
