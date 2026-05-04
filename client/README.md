# HealthBilling client

React 18 + TypeScript + Vite SPA. Calls the API under `/api` (proxied to the Node server in local dev).

From **`client/`**: `npm install` then `npm run dev`.

Environment variables are loaded from the **repository root** `.env` (parent of `client/`; see `vite.config.ts` `loadEnv`). You can also use `client/.env` for overrides.
