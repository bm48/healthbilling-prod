# Setup

The full setup guide is **[`server/docs/SETUP.md`](server/docs/SETUP.md)**.

**TL;DR** (from repository root):

1. `npm install`
2. `cp .env.example .env` and set `DATABASE_URL`, JWT secrets, and `FRONTEND_ORIGIN`
3. Apply SQL from **`server/database/`** (schema dump) and/or ordered files in **`server/supabase/`**
4. `npm run server:dev` and `npm run dev` in two terminals

The codebase lives in **`client/`** (React) and **`server/`** (Express API) only.
