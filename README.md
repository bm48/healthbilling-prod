# HealthBilling

Two separate Node packages:

| Folder    | Role                         | Install & dev                          |
| --------- | ---------------------------- | -------------------------------------- |
| **`client/`** | React + Vite SPA             | `cd client` → `npm install` → `npm run dev` |
| **`server/`** | Express API + PostgreSQL   | `cd server` → `npm install` → `npm run dev` |

Each folder has its own **`package.json`** and **`package-lock.json`**. There is no root npm workspace.

- **API** default: `http://localhost:4000`
- **App** default: `http://localhost:5173` (Vite proxies `/api` to the API)

Setup, env vars, database, and production notes: **`server/docs/SETUP.md`**.
