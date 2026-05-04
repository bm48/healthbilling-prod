# HealthBilling Setup Guide

## Quick start

The repo has two **independent** Node packages (each with its own `package.json` and `package-lock.json`):

- **`client/`** — React + Vite + TypeScript (browser app)
- **`server/`** — Express + PostgreSQL API

### 1. Install dependencies

Install in **both** folders (two commands):

```bash
cd client && npm install
```

```bash
cd server && npm install
```

### 2. Configure environment variables

Copy `.env.example` to **`.env` in the repository root** (one level above `client/` and `server/`). Vite and the API both load that file, plus `client/.env` and `server/.env` if you add them. Set at minimum:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — long random strings (24+ characters)
- `FRONTEND_ORIGIN` — e.g. `http://localhost:5173`

Optional: `GMAIL_USER` / `GMAIL_APP_PASSWORD` for contact form and invite emails. See `.env.example`.

**Contact form fails with `ETIMEDOUT` to a private IP (e.g. `10.x.x.x:465`)**  
Your network/DNS is routing `smtp.gmail.com` to an internal relay or blocking outbound SMTP. Fix outside the app: use another network/VPN, open firewall port **465** (default) or **587**, or set **`SMTP_HOST`** / **`SMTP_PORT`** / **`SMTP_SECURE`** in `server/.env` to an SMTP endpoint your IT allows (org relay, SendGrid, etc.).

Vite loads env from the **repo root** so one `.env` file is enough for local dev.

### 3. Database schema

Apply either:

- `server/database/public.sql` (full `public` schema dump), or  
- Ordered files under `server/supabase/` (migration history),

to your PostgreSQL instance (e.g. `psql`, pgAdmin, or any SQL client).

### 4. Create an initial super admin

Insert a row into `public.users` with `role = 'super_admin'` and a **bcrypt** hash in the `password` column (the API uses `public.users.password` for login). You can:

- Use **Super Admin Settings** in the UI after creating the first user by SQL, or  
- Generate a hash with Node: `node -e "require('bcryptjs').hash('YourPassword',10).then(console.log)"` and run `INSERT INTO public.users (...)` accordingly.

### 5. Run in development

Use **two terminals**:

**Terminal 1 — API** (from `server/`):

```bash
cd server
npm run dev
```

**Terminal 2 — web app** (from `client/`):

```bash
cd client
npm run dev
```

- API: `http://localhost:4000` (default)
- App: `http://localhost:5173` — Vite proxies `/api` to the API

**Important:** In `server/`, `npm start` runs **`node dev.mjs`** (TypeScript via `tsx watch`), same as `npm run dev`, so you always run the latest `src/` code and see `console.log` output.  
For production, from **`server/`**: run **`npm run build`** then **`npm run start:prod`**.

If you run **`node dist/index.js`** without rebuilding after editing `src/`, you will get **stale behavior** (missing logs, old bugs).

### 6. Production build

```bash
cd client && npm run build
```

```bash
cd server && npm run build
```

Produces **`client/dist`** and **`server/dist`**.

## Project structure

```
HealthBilling/
├── client/                 # Vite React app (npm package: health-billing-client)
│   ├── src/
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   ├── package-lock.json
│   └── tsconfig.json
├── server/                 # Express API (npm package: health-billing-server)
│   ├── src/
│   ├── sql/
│   ├── database/           # Schema dumps
│   ├── supabase/           # Incremental SQL migrations
│   ├── vercel-api/         # Optional Vercel serverless proxies
│   ├── docs/               # This guide and other notes
│   ├── package.json
│   └── package-lock.json
└── .env.example
```

## Key Features Implemented

✅ Landing page with comprehensive images
✅ Authentication system (Login)
✅ Role-based routing and navigation
✅ Dashboard with quick actions
✅ Patient database interface
✅ Billing To-Do list
✅ Timecards with clock in/out
✅ Reports interface
✅ Admin and Super Admin settings pages
✅ Database schema with RLS policies
✅ TypeScript types for all entities

## Next Steps for Full Implementation

The following features have placeholder implementations and need full development:

1. **Provider Sheet Component**: Full spreadsheet interface with all columns (A-AE)
2. **Column Permissions**: Implement role-based column visibility and editing
3. **Month Close & Locking**: Implement column locking after month close
4. **Reporting System**: Generate actual reports with PDF export
5. **Super Admin Interface**: Full user management, billing code configuration
6. **Audit Logging**: Display and filter audit logs
7. **Patient Database**: Full CRUD operations
8. **To-Do List**: Complete with notes, status management, and claim linking

## Database Tables

- `clinics` - Clinic information
- `users` - User profiles with roles
- `patients` - Patient database
- `billing_codes` - Billing codes with colors
- `provider_sheets` - Provider schedule/billing sheets
- `todo_items` - Billing To-Do items
- `todo_notes` - Notes on To-Do items
- `timecards` - Time tracking for Billing Staff
- `audit_logs` - Complete audit trail

## Role Permissions Summary

- **Super Admin**: Full system access
- **Admin**: Full access to assigned clinics
- **View-Only Admin**: Read-only access
- **Billing Staff**: Edit billing data, manage To-Do, timecards
- **View-Only Billing**: View provider sheets only
- **Provider**: Edit own schedule (Columns A-I)
- **Office Staff**: Manage schedules and patient payments

## Troubleshooting

### API / database connection

- Verify root `.env` has a valid `DATABASE_URL` and JWT secrets
- Ensure the API is running (`cd server && npm run dev`) when using the Vite dev proxy
- Check `FRONTEND_ORIGIN` matches the URL you open in the browser (CORS)

### Database errors

- Ensure `server/database/public.sql` or the `server/supabase/` migrations were applied to the same database as `DATABASE_URL`
- Confirm `public.users` and related tables exist

### Build Errors

- Run `npm install` in **`client/`** and **`server/`** so both lockfiles are satisfied
- Check Node.js version (requires 18+)
- Clear node_modules and reinstall if needed
