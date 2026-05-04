# HealthBilling server

Express API, PostgreSQL (`pg`), JWT auth, file storage for backups.

- **`src/`** — application code  
- **`sql/`** — `bootstrap.sql` and related  
- **`database/`** — reference schema dumps (`public.sql`, etc.)  
- **`supabase/`** — ordered SQL migration history  
- **`vercel-api/`** — optional tiny serverless handlers that forward to this API  
- **`docs/`** — setup guide and notes  

From **`server/`**: `npm install` then `npm run dev` (or `npm start`). `dev.mjs` runs `tsx watch` using `tsx` from `server/node_modules` (or a parent `node_modules` if present).

Loads `.env` from the **repository root** (parent of `server/`) and from `server/.env` if present.
