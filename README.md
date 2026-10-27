# ⚖️ FairShift — Decent Work Platform (UN SDG 8)

Fairer, safer and more transparent workplaces for shift-based, employee-intensive organisations.
Built for **Prompt Wars 2026 × SRM ACM Student Chapter**.

One platform, **two interfaces** (worker app + employer dashboard), demonstrated across **four sectors**:
construction, college/campus, hospital and factory.

## The problem
Workers on paper registers and WhatsApp groups face opaque pay, fear of speaking up, unreported hazards and
lost career history. Employers have no visibility into overwork, attrition risk or growing complaints.

## What it does (8 working features)
| # | Feature | Worker UI (`/worker.html`) | Employer UI (`/admin.html`) |
|---|---------|---------------------------|------------------------------|
| 1 | **Shift tracking** | QR scan or site-code check-in/out, optional geofence check, **automatic overtime** | Printable per-site QR codes, presence KPIs |
| 2 | **Clear payslips** | Line-by-line breakdown (regular, overtime × rate, PF, ESI) in the worker's language | — |
| 3 | **Safety reporting** | Type **or speak** a hazard; anonymous by default; tracking code | Triage list sorted by severity; status updates (Received → Being looked at → Fixed) |
| 4 | **Honest feedback** | 3 quick star ratings, 1 per week, stored with **no worker identity** | Results shown only when **≥ 3** responses (k-anonymity) |
| 5 | **Skill passport** | Verified / self-declared skills, shareable read-only link | Issue and verify credentials |
| 6 | **Fatigue alerts** | Gentle "rest check" (long shifts, < 11 h rest, > 48 h/week, 7 days straight) | Fatigue column per person |
| 7 | **Admin dashboard** | — | Attendance trend, overtime, open hazards, fatigue alerts, explainable quit-risk |
| 8 | **Voice & local languages** | English, தமிழ், हिन्दी, తెలుగు; read-aloud payslip; voice dictation | Sector filter, multilingual shared terms |

Anyone can follow an anonymous hazard report on the home page using only its tracking code.

### Cross-sector use cases
- **Construction site** – 12-hour days with no rest day are flagged; unresolved scaffold hazards raise attention.
- **Hospital** – night/early shift rotation with < 11 h rest is flagged for ward staff.
- **College campus** – facilities staff get payslips in Tamil; wet-floor reports are tracked to "Fixed".
- **Factory** – overtime-heavy operators surface in the dashboard; press-guard hazards triaged by severity.

Sector rules (standard hours, overtime multiplier, weekly limits) live in `src/config.js`, so adding a sector is a config change.

## Inclusivity & low-end phones
Large touch targets (≥ 52 px), icons next to every label, high-contrast colours (WCAG AA), visible focus rings,
full keyboard navigation (ARIA tabs with arrow keys), screen-reader labels, voice input/output where the browser
supports it. **No frameworks, no build step, no web fonts or images** — the whole front end is ~60 KB.

## Architecture
```
server.js            entry point (graceful SIGTERM for Cloud Run)
src/app.js           Express app factory (store, clock and config injected → testable)
src/config.js        sector rules, thresholds, env-driven settings
src/auth.js          HMAC-signed session tokens, role guard
src/middleware.js    CSP & security headers, rate limiter, input cleaning
src/store.js         in-memory store (swap for Firestore by re-implementing this class)
src/seed.js          deterministic demo data (12 workers, 4 sites, 30 days of shifts)
src/domain/          pure, unit-tested logic: shifts, payslip, fatigue, risk, insights
src/routes/          public / worker / admin REST routes
public/              vanilla JS front end (no inline scripts or styles → strict CSP)
test/                node:test unit + API tests (25)
```

## Security
- **No secrets in the repo.** `SESSION_SECRET` / `SEED_PIN` come from environment variables; PINs are hashed with scrypt.
- Strict **Content-Security-Policy** (no inline script/style), `nosniff`, `frame-ancestors 'none'`, no `X-Powered-By`.
- Role-based access, rate limiting, request size limit, input validation and sanitisation; UI renders text via `textContent` only.
- Anonymous feedback rows have **no worker id**; reports are anonymous unless the worker opts in.
- The quit-risk score is a rule-based heuristic whose every point is explained, meant to prompt *supportive* fixes
  (schedules, safety), never discipline.

## Run locally
```bash
npm install
DEMO_MODE=true npm start        # http://localhost:8080
npm test                        # 25 tests
```
With `DEMO_MODE=true` the home page offers one-tap **Worker view** / **Employer view** logins for reviewers.
Without it, sign in with an employee ID (`W001`…`W012`, `A001`) and the PIN from `SEED_PIN` (or the one printed in the dev log).

## Deploy to Google Cloud Run
```bash
gcloud run deploy fairshift \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --max-instances 1 \
  --memory 256Mi \
  --set-env-vars DEMO_MODE=true,SESSION_SECRET=$(openssl rand -hex 32)
```
`--max-instances 1` keeps the in-memory demo data consistent for every viewer.

## Limitations / next steps
Data is in-memory and re-seeded on restart (prototype). Next: Firestore persistence, WhatsApp/SMS check-in for
feature phones, signed rotating QR codes, native-speaker review of translations, statutory rules per state.
Payroll figures are illustrative, not legal advice.

## Deploying on Vercel (alternative)
`api/index.js` + `vercel.json` expose the same app as a serverless function; static pages are served from `public/`.
Set env vars `DEMO_MODE=true` and `SESSION_SECRET=<random string>`. Note: serverless instances don't share memory,
so data written during the demo (check-ins, reports) is per-instance and not durable. Use Cloud Run with
`--max-instances 1` (see above) or add Firestore for consistent state.
