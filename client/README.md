# HealthBilling client

React 18 + TypeScript + Vite SPA. Calls the API under `/api` (proxied to the Node server in local dev).

From the **repository root**: `npm run dev` (workspace script) or `npm run dev -w client`.

Environment variables are loaded from the **monorepo root** `.env` (see `vite.config.ts` `loadEnv`).
