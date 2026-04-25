# HealthBilling - Healthcare Revenue Management System

A comprehensive, role-based healthcare billing and revenue tracking system built with React, a Node.js API, and PostgreSQL.

**Layout:** application code and data artifacts live in **`client/`** and **`server/`** only. The repo root holds workspace config (`package.json`), env templates, and this README. SQL dumps and migrations are under **`server/database/`** and **`server/supabase/`**.

## Features

- **Role-Based Access Control**: Granular permissions for Super Admin, Admin, Billing Staff, Providers, and Office Staff
- **Provider Schedule & Billing Sheets**: Comprehensive spreadsheet-style interface with columns A-AE
- **Patient Database**: Centralized patient management with lookup integration
- **Billing To-Do List**: Track follow-up items with custom statuses and notes
- **Accounts Receivable**: Manage late payments and adjustments
- **Timecard Management**: Track Billing Staff hours with clock in/out
- **Comprehensive Reporting**: Generate reports by provider, clinic, claim, patient, labor, and invoices
- **Month Close & Locking**: Lock critical columns after month close
- **Audit Logging**: Complete audit trail of all changes

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS
- **Backend**: Node.js (Express) + PostgreSQL + local file storage for backups
- **Routing**: React Router v6
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn
- PostgreSQL 15+ and Node.js 18+

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd HealthBilling
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables (`cp .env.example .env`) and fill in `DATABASE_URL`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET` for the API (see `.env.example`).

4. Apply `server/database/public.sql` (or the ordered SQL files under `server/supabase/`) to PostgreSQL.

5. Start the development server (run the API in another terminal with `npm run server:dev`):
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

## Project structure

```
client/                 # React + Vite SPA
├── src/
│   ├── components/
│   ├── contexts/
│   ├── lib/            # API client (`apiClient`), helpers
│   ├── pages/
│   └── types/
├── index.html
└── vite.config.ts

server/                 # Express API + PostgreSQL access
├── src/
├── sql/                # API bootstrap SQL
├── database/         # Schema dumps (e.g. public.sql)
├── supabase/         # Incremental SQL migration history
├── vercel-api/       # Optional serverless proxies (e.g. Vercel → Node API)
└── docs/             # SETUP and project notes
```

## User Roles

- **Super Admin**: Full system access, user management, configuration
- **Admin**: Full access to assigned clinics, AR management, month close
- **View-Only Admin**: Read-only access to all clinic data
- **Billing Staff**: Edit billing data, manage To-Do list, timecards
- **View-Only Billing**: View-only access to provider sheets
- **Provider**: Edit own schedule and billing codes (Columns A-I)
- **Office Staff**: Manage schedules and patient payments for one clinic

## Database Schema

The database includes tables for:
- Users (with role-based access)
- Clinics
- Patients
- Provider Sheets (with row data as JSONB)
- Billing Codes
- Todo Items & Notes
- Timecards
- Audit Logs

See `server/database/public.sql` for a full schema dump, or `server/supabase/` for incremental migration history.

## Development

### Building for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## License

Proprietary - All rights reserved
