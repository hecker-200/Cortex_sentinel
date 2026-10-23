# CORTEX

Verification-first practice for clinical AI. A trainee reads a cardiac POCUS clip,
commits an answer and a confidence rating, then sees an AI read that is
deliberately wrong in about 1 in 4 cases. They keep their answer or switch, and
CORTEX measures how often they catch AI errors, how often they follow a wrong AI
(automation bias), their unaided accuracy and their calibration. A fixed,
explainable rule set picks every next case.

This is a full web application: accounts and roles, a Postgres database, the
case-picking engine on the server, cohorts for educators, CSV export, and admin
tools for cases, clips and clinical sign-off.

> **Training simulation, not a medical device.** The bundled clips are synthetic
> placeholders and the case content is draft until a clinician signs it off in the app.

## What each role can do

| Role | Can |
| --- | --- |
| **Trainee** | Practise, see their own metrics and reliance matrix, join cohorts with a code, change password |
| **Educator** | Everything a trainee can, plus create cohorts and invite links, see cohort results, download CSV, sign off cases, run policy checks, add a simulated demo cohort |
| **Admin** | Everything an educator can, plus create and edit cases, upload clips, change user roles, issue temporary passwords, see the activity log |

The first account created becomes the admin (or the account whose email matches `ADMIN_EMAIL`).
Educators sign up with `EDUCATOR_SIGNUP_CODE`, or an admin promotes them on the Admin page.

## Run it on your computer

Needs Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173 and create an account (it becomes the admin). Data is stored
in an embedded Postgres database in `./.data/pglite`, so no database setup is needed
locally. Delete that folder to start fresh.

## Deploy (free tier, about 15 minutes)

The app is one Node service plus one Postgres database. The 24 case clips are stored
in the database, so there is no file storage to set up.

**1. Create the database (Neon, free and does not expire)**
1. Sign up at neon.tech and create a project.
2. Copy the connection string. It looks like
   `postgres://user:password@ep-xxx.neon.tech/neondb?sslmode=require`.

**2. Put the code on GitHub**
```bash
git init && git add . && git commit -m "CORTEX"
gh repo create cortex --private --source=. --push   # or create the repo on github.com and push
```

**3. Create the web service (Render)**
1. On render.com: New → Blueprint → pick the repo. Render reads `render.yaml`.
2. When asked, paste the Neon string as `DATABASE_URL` and your email as `ADMIN_EMAIL`.
   `EDUCATOR_SIGNUP_CODE` is generated for you; find it under the service's Environment tab.
3. Deploy. On first start the app creates its tables and loads the 24 draft cases.
4. Open the URL Render gives you and sign up with your `ADMIN_EMAIL`.

Render's free web service sleeps after 15 minutes without traffic, so the first request
after that takes about a minute. Use a paid instance ($7/month) for a pilot.

**Other hosts.** Anything that runs Node 20+ works with the same two commands:
build `npm ci --include=dev && npm run build`, start `npm start`, plus `DATABASE_URL`.
A `Dockerfile` is included for Fly.io, Railway, a VPS or a hospital server. It has not
been built in this environment (no access to Docker Hub here), so test it once before
relying on it.

### Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | In production | Postgres connection string. Without it the app uses the embedded database in `DATA_DIR`. |
| `ADMIN_EMAIL` | No | The account with this email becomes admin on sign-up. Otherwise the first account is admin. |
| `EDUCATOR_SIGNUP_CODE` | No | Code that lets people sign up as educators. If unset, admins promote educators. |
| `PORT` | No | Default 3000. |
| `NODE_ENV` | Yes, `production` | Turns on secure cookies. |
| `DATA_DIR` | No | Embedded database folder when `DATABASE_URL` is unset. Default `./.data/pglite`. |
| `SEED_DIR` | No | Where first-run cases and clips are loaded from. Default `./seed`. |

## How it works

```
browser (React)  ──HTTPS──▶  Node/Express API  ──▶  Postgres
                               │
                               ├─ auth: bcrypt passwords, hashed session tokens in httpOnly cookies
                               ├─ policy engine (src/engine): picks each case, logs a reason code
                               ├─ practice: answer → AI reveal → final → feedback, all server-side
                               ├─ cohorts, CSV export (pseudonymous)
                               └─ admin: cases, clips (stored in Postgres), sign-off, roles, audit log
```

**The answer never reaches the browser early.** Before a trainee answers, the API sends
only the question, the options and a clip URL addressed by the case's decision ID. The
case ID, the reference answer, the AI's read and the rationale arrive only after the
trainee commits. Clips are pre-rendered video, so the clip parameters (EF, effusion size)
are not in the page either. The integration tests check this.

**Security measures:** bcrypt password hashes; session tokens stored only as SHA-256
hashes; httpOnly, SameSite=Lax, Secure cookies; a required `X-Requested-With` header on
every state-changing call (blocks cross-site form posts); rate limits on sign-in, sign-up
and password changes; strict Content-Security-Policy; role checks on every educator and
admin route; trainees can only reach their own cases and clips; an audit log of every
case, cohort and role change.

**Clinical review workflow.** Every case starts as Draft. An educator or admin signs it
off in the Case bank, with an optional note, and the sign-off is stored with their name
and time. Any later edit or new clip sends it back to Draft.

### Project layout

| Path | What it holds |
| --- | --- |
| `src/engine/` | Policy rules, reliance matrix, metrics, simulated personas. Shared by server and tests. |
| `src/engine/config.ts` | Every threshold. Bump `POLICY_VERSION` when you change one. |
| `src/screens/` | Sign-in, consent, Practice, My profile, Cohorts, Case bank, Admin |
| `server/` | Express app, database layer and migrations, routes, seed loader |
| `seed/cases.json`, `seed/clips/` | First-run case bank and its clips |
| `tools/render-clips.py` | Regenerates the synthetic clips (needs Playwright and ffmpeg) |

### Policy rules (first match wins)

| Rule | When | Then |
| --- | --- | --- |
| R1 `INSUFFICIENT_EVIDENCE` | Fewer than 6 human-first cases in a domain | Human-first case, AI wrong 25% of the time |
| R2 `AUTOMATION_BIAS_PATTERN` | 2+ switches to a wrong AI answer in the last 10 cases of a domain | Human-first, AI wrong 40%, reflection prompt |
| R3 `LOW_INDEPENDENT_ACCURACY` | Independent accuracy below 60% (n ≥ 6) | Guided case → practice case → unaided check |
| R4 `OVERCONFIDENCE` | 30%+ of 4–5 confidence answers wrong (n ≥ 8) | Human-first with a second-look prompt |
| R5 `VERIFIED_INDEPENDENCE` | Error-catch ≥ 80% and independent accuracy ≥ 80% (n ≥ 10), and not routinely rejecting a correct AI | AI-first cases, unaided check every 5th case |
| R6 `DEFAULT_SCHEDULE` | Otherwise | Human-first, with every 3rd case a matched-pair case (AI-first or unaided, counterbalanced) |

## Replacing the placeholder clips with real echoes

1. Get the data legitimately, for example EchoNet-Dynamic (Stanford AIMI, research-use
   agreement) or de-identified teaching clips from a clinical collaborator with permission.
2. Convert to MP4 (H.264 plays in every major browser):
   `ffmpeg -i input.avi -vf scale=640:-2 -c:v libx264 -pix_fmt yuv420p -crf 26 -movflags +faststart -an out.mp4`
3. In the app: Case bank → pick a case → Replace clip. Edit the reference answer and
   rationale to match (for EchoNet, EF ≥ 50% normal, 30–49% reduced, < 30% severely reduced).
4. Have a clinician sign it off.

## Tests

```bash
npm test                                   # 29 tests: engine + API on the embedded database
TEST_DATABASE_URL=postgres://... npm test  # the API tests against a real Postgres (wipes its schema)
```

The suite covers sign-up and roles, the no-early-answer rule, a 15-case practice run,
cross-user access, cohorts and CSV, the demo cohort, case editing, clip upload and
sign-off, password resets, concurrent requests, and the persona checks for every policy rule.

## Before real trainees use it

- **Ethics approval** for any data you plan to analyse or publish.
- **Clinical sign-off** of every case and every seeded wrong AI read.
- **Backups**: Neon keeps point-in-time history; check the retention on your plan.
- **Not built yet**: email verification and self-service password reset by email
  (admins issue temporary passwords instead), account deletion by the user (an admin
  can do it in the database), and SSO.
