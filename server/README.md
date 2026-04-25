# HealthBilling server

Express API, PostgreSQL (`pg`), JWT auth, file storage for backups.

- **`src/`** — application code  
- **`sql/`** — `bootstrap.sql` and related  
- **`database/`** — reference schema dumps (`public.sql`, etc.)  
- **`supabase/`** — ordered SQL migration history  
- **`vercel-api/`** — optional tiny serverless handlers that forward to this API  
- **`docs/`** — setup guide and notes  

From the **repository root**: `npm run server:dev` or `npm run dev -w server`.  
From **`server/`**: `npm run dev` uses `dev.mjs` to find `tsx` whether it is hoisted to the repo root or installed locally (fixes Windows `tsx` not in PATH).

Loads `.env` from the repo root and from `server/.env` if present.
