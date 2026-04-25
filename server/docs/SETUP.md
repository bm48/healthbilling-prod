# HealthBilling Setup Guide

## Quick start

This repo is an **npm workspaces** monorepo:

- **`client/`** — React + Vite + TypeScript (browser app)
- **`server/`** — Express + PostgreSQL API

### 1. Install dependencies

From the repository root:

```bash
npm install
```

This installs hoisted dependencies for both workspaces.

### 2. Configure environment variables

Copy `.env.example` to **`.env` in the repository root** (shared by Vite and the API server). Set at minimum:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — long random strings (24+ characters)
- `FRONTEND_ORIGIN` — e.g. `http://localhost:5173`

Optional: `GMAIL_USER` / `GMAIL_APP_PASSWORD` for contact form and invite emails. See `.env.example`.

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

Two terminals from the **repository root**:

```bash
npm run server:dev
```

```bash
npm run dev
```

- API: `http://localhost:4000` (default)
- App: `http://localhost:5173` — Vite proxies `/api` to the API

### 6. Production build

```bash
npm run build
```

Builds **`client/dist`** and **`server/dist`**.

## Project structure

```
HealthBilling/
├── client/                 # Vite React app (workspace: health-billing-client)
│   ├── src/
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   └── tsconfig.json
├── server/                 # Express API (workspace: health-billing-server)
│   ├── src/
│   ├── sql/
│   ├── database/           # Schema dumps
│   ├── supabase/           # Incremental SQL migrations
│   ├── vercel-api/         # Optional Vercel serverless proxies
│   ├── docs/               # This guide and other notes
│   └── package.json
├── package.json            # workspaces root
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
- Ensure the API is running (`npm run server:dev`) when using the Vite dev proxy
- Check `FRONTEND_ORIGIN` matches the URL you open in the browser (CORS)

### Database errors

- Ensure `server/database/public.sql` or the `server/supabase/` migrations were applied to the same database as `DATABASE_URL`
- Confirm `public.users` and related tables exist

### Build Errors

- Run `npm install` to ensure all dependencies are installed
- Check Node.js version (requires 18+)
- Clear node_modules and reinstall if needed
