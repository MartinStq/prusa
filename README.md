# Prusa Pilot 3D — Console Opérateur Locale

Application web locale (Next.js App Router, TypeScript, Tailwind CSS, Prisma + SQLite, Three.js) pour piloter un service d'impression 3D sur une imprimante Prusa connectée en Wi-Fi via **PrusaLink**.

## Architecture évolutive (Prêt pour Odoo Online)

Toute la logique métier et d'accès aux demandes est isolée dans `src/services/orders.ts` :
- `getOrders`
- `getOrderById`
- `createOrder`
- `updateOrderDecision`
- `updateOrderStatus`

L'interface et les routes API consomment exclusivement ces fonctions et le DTO `PrintOrder` (`src/types/orders.ts`), ce qui permettra de remplacer ultérieurement SQLite par des appels JSON-RPC/XML-RPC vers **Odoo Online** sans modifier les composants UI.

## Stockage local

- Base de données SQLite : `prisma/dev.db`
- Modèles 3D clients (`.stl`) : `./data/stl/`
- Fichiers tranchés PrusaSlicer (`.gcode`, `.bgcode`) : `./data/gcode/`

## Configuration (`.env`)

Copiez `.env.example` vers `.env` et ajustez selon votre environnement :

```bash
cp .env.example .env
```

- `PRUSA_MOCK="true"` : simule localement les réponses de l'imprimante Prusa (températures, progression, lancement G-code) hors du réseau du laboratoire.
- `PRUSA_MOCK="false"` : active la communication Wi-Fi réelle avec PrusaLink (`PRUSA_IP` + header `X-Api-Key: PRUSA_API_KEY`).

## Commandes utiles

```bash
# Installer les dépendances
npm install

# Appliquer les migrations SQLite
npx prisma migrate dev --name init

# Générer les fichiers STL de test et les 5 demandes fictives
npm run db:seed

# Lancer le serveur de développement local
npm run dev
```

Ouvrez ensuite `http://localhost:3000`.
