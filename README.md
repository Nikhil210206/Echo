# Echo

**Every voice gets an answer.** A closed-loop feedback platform: submit via QR, analyze by aspect, cluster into issues, prioritize, resolve, and let submitters verify the fix.

Vision2Web Full Stack Hackathon · Problem Statement 2 (Smart Feedback Analyzer)

## Structure

```
backend/    FastAPI + SQLAlchemy + PostgreSQL
  app/services/   analysis, clustering, priority, spikes, lifecycle, verification, stats
  app/routers/    public, admin, issues, stream, ask
frontend/   React (Vite) + Tailwind + shadcn/ui
  src/pages/public/   Submit, Track, Transparency
  src/pages/admin/    Login, Dashboard, Feedback, Moderation, Issues, IssueDetail, QRCodes
docs/       API contract and plan
```

## Team

| Area | Owner |
|---|---|
| Frontend | Nikhil |
| Backend: analysis & intelligence | Aaditya |
| Backend: platform API & data | Aditi |

## Setup

```bash
cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

```bash
cd frontend && npm install
cp .env.example .env
npm run dev          # http://localhost:5180
```

With `VITE_USE_MOCKS=true` (the default) the frontend runs on an in-memory mock of the API, so every screen works before the backend is up. Set `VITE_USE_MOCKS=false` and `VITE_API_URL` to use the real backend.

**Staff console** is at `/admin`. In mock mode the login page offers demo accounts (admin, IT services, Mess manager).

Before the demo, set `VITE_PUBLIC_URL` to the deployed address so the printed QR codes point somewhere phones can reach.
