<div align="center">

# 🎯 Recruitly

### Interview scheduling & placement coordination — solved as a constraint-satisfaction problem


</div>

---

## 📌 What is Recruitly?

Campus hiring means hundreds of candidates, a handful of interviewers, limited rooms, and a mountain of emails. **Recruitly** replaces that chaos with an engine that builds a **clash-free interview schedule automatically**, explains anything it can't place, and tracks every candidate through the rounds.

| 👤 Role | 🧭 What they do |
|---|---|
| 🧑‍💼 **Coordinator** | Sets up drives, rounds, rubrics, rooms; generates, validates and publishes schedules; reschedules safely |
| 🎤 **Interviewer** | Sets availability and skills, sees interviews, submits blinded evaluations |
| 🎓 **Candidate** | Sets availability, self-books a slot, tracks progress |
| 🏢 **Company** | Read-only view of pipeline, schedules, summaries and reports |

---

## ✨ Features

- 🧠 **Constraint-based scheduling engine** with an independent validator and a 0–100 quality score
- 🔎 **Plain-language conflict explanations** for every candidate who could not be placed
- ♻️ **Minimal-disruption rescheduling** with preview → approve → apply
- 🔗 **Self-booking links** (256-bit tokens, stored only as SHA-256 hashes)
- 🙈 **Blinded evaluations** enforced on the server
- 🔐 **JWT in HTTP-only cookie**, bcrypt, CSRF header, role-based access control
- 🔔 **Live notifications** via Socket.IO
- 🌗 **Dark mode**, responsive UI, calendar and charts
- 🛡️ **Double-booking is impossible at the database level** (PostgreSQL `EXCLUDE` constraints)

---

## 🧰 Tech Stack

| Layer | Tech |
|---|---|
| 🎨 Frontend | React 18, Vite, Tailwind CSS, FullCalendar, Recharts, react-hook-form, axios |
| ⚙️ Backend | Node.js (ESM), Express, Zod validation, node-cron, Socket.IO |
| 🗄️ Database | PostgreSQL via `pg` (handwritten SQL, auto-run migrations) |
| ✉️ Integrations | Nodemailer (SMTP), Google OAuth / Calendar / Meet (optional) |
| 🧪 Testing | Node built-in test runner (`node --test`) |

---

## 🗂️ Project Structure

```
Recruitly/
├── server/                      # Express API
│   ├── src/
│   │   ├── scheduling/          
│   │   │   ├── core.js             
│   │   │   ├── scheduleSolver.js    
│   │   │   ├── constraintValidator.js  
│   │   │   ├── explainConflict.js   
│   │   │   ├── scoreSchedule.js     
│   │   │   ├── rescheduleEngine.js  
│   │   │   └── slotGenerator.js, availability.js, timeUtils.js
│   │   ├── services/  routes/  middleware/  migrations/  db/
│   ├── tests/                   # unit + API tests
│   └── benchmarks/              # performance & edge-case benchmarks
└── client/                      # React app
```

---

## 🚀 Quick Start

```bash
# 1) Backend
cd server
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm install
npm run db:reset              # fresh schema
npm run db:seed               # demo data 
npm run dev                   # http://localhost:5000

# 2) Frontend (new terminal)
cd client
npm install
npm run dev                   # http://localhost:5173
```


## 🧪 Unit Tests

```bash
cd server
npm test            # everything (engine + API)  — needs a DB user with CREATEDB
node --test tests/scheduling.test.js tests/reschedule.test.js   # engine only, no DB needed
```

**36 tests in total** — the scheduling and reschedule suites need no database.

| Suite | Tests | What it proves |
|---|---|---|
| `scheduling.test.js` | 17 | Every hard constraint is respected; unschedulable candidates are explained correctly |
| `reschedule.test.js` | 6 | Reschedules change as little as possible and never touch locked interviews |
| `api.test.js` | 13 | Auth, roles, booking tokens, blinded evaluation, rate limits |

<details>
<summary>📋 Engine test cases (click to expand)</summary>

- Time utilities convert wall-clock time correctly in the drive's time zone
- Availability resolver applies rules, additive and subtractive exceptions
- Schedules everyone and satisfies every hard constraint (verified by the independent validator)
- Candidate availability and unavailable intervals are respected
- Interviewers without the required skill are never assigned
- Daily capacity is never exceeded; leftovers are explained
- Panel requirements are satisfied
- Offline sessions get a room; online sessions never reserve one
- Offline preference falls back to online when no room is free
- A mandatory mode policy is never silently overridden
- Conflict explanations name the real blocking constraint
- Prerequisite rounds are enforced
- Existing bookings and buffers are respected
- Quality score is deterministic and never hides violations
- Validator detects injected hard-constraint violations
- Feasible slots only list bookable times
- Larger drive (60 candidates, 6 interviewers, 4 rooms) schedules within budget
- Reschedule: same-slot substitution first, unrelated interviews untouched
- Reschedule: mode and room preserved where feasible
- Reschedule: nearest feasible slot when no substitute exists
- Reschedule: unresolvable interviews marked `needs_rebooking`
- Reschedule: completed or locked interviews never moved
- Reschedule: realistic scenario changes as few interviews as possible

</details>

---

## 🧠 Constraint Satisfaction Algorithm Breakdown

### 1️⃣ Problem model (CSP)

| CSP element | In Recruitly |
|---|---|
| **Variables** | One interview per candidate for the chosen round |
| **Domain** | Start times where the candidate is free **and** at least one valid resource option exists (interviewer panel + mode + room) |
| **Hard constraints** | See below — a schedule violating any of these is invalid |
| **Soft goals** | Balanced workload, few idle gaps, candidate preferences, mode preferences, stability |

**🚫 Hard constraints (never broken)**

1. A candidate, interviewer or room is never in two places at once (including buffers)
2. Everyone must be available in that time window
3. Interviewers must hold every skill the round requires; panel size and panel requirements are met
4. Mode policy is respected (online / offline); offline interviews need a room with the required equipment and capacity
5. Interviewer daily capacity and minimum break are respected
6. A prerequisite round must be passed first
7. Existing, locked or completed interviews are never moved

### 2️⃣ Solving pipeline

```
 ┌─────────────────────────────┐
 │ 1. Static domain filtering  │  candidates that can NEVER be scheduled are
 └──────────────┬──────────────┘  separated up front (and proven impossible)
                ▼
 ┌─────────────────────────────┐
 │ 2. Greedy + MRV             │  always place the most-constrained candidate
 └──────────────┬──────────────┘  next (fewest feasible start times)
                ▼   (only if someone is left out)
 ┌─────────────────────────────┐
 │ 3. Capacity proof           │  if total capacity < demand, stop: provably
 └──────────────┬──────────────┘  impossible, no need to search
                ▼   (not provable)
 ┌─────────────────────────────┐
 │ 4. Budgeted DFS             │  backtracking with forward checking; stops at
 └──────────────┬──────────────┘  max nodes / max milliseconds
                ▼
 ┌─────────────────────────────┐
 │ 5. Local improvement        │  ejection chains (move one to fit another),
 └──────────────┬──────────────┘  then workload re-balancing
                ▼
 ┌─────────────────────────────┐
 │ 6. Independent validation   │  a separate checker re-verifies every rule;
 └──────────────┬──────────────┘  violating assignments are dropped, never returned
                ▼
 ┌─────────────────────────────┐
 │ 7. Explain & score          │  reason per unscheduled candidate + 0-100 score
 └─────────────────────────────┘
```

**Result statuses:** `complete` · `partial` · `infeasible` (every cause proven) · `budget_exhausted` (time/node budget hit before proving impossibility).

**Why these techniques?**

- **MRV (Minimum Remaining Values)** — fail-first: the candidate with the fewest options is placed before the choices run out.
- **Forward checking** — the DFS abandons a branch the moment any remaining candidate has zero options.
- **Budgeted search** — guarantees a bounded response time instead of an unbounded exact search.
- **Independent validator** — the solver never "marks its own homework".
- **Database `EXCLUDE` constraints** — a final safety net even if application code had a bug.

### 3️⃣ ⏱️ Complexity analysis

Let **n** = candidates, **D** = start times per candidate (days × slots/day), **I** = interviewers, **R** = rooms, **C** = cost of one option check ≈ O(I + R), **N** = DFS node budget, **m** = scheduled interviews.

| Stage | Time complexity | Notes |
|---|---|---|
| Domain filtering | O(n · D · C) | one pass |
| Greedy + MRV | **O(n² · D · C)** | MRV recount for every remaining candidate after each placement |
| Capacity proof | O(n + I) | counting argument |
| Budgeted DFS | O(N · n · D · C) | worst case exponential, **hard-capped** by node budget N (default 20 000) and time (default 4 s) |
| Ejection / rebalance | polynomial, bounded by number of unscheduled × placed | single-step chains only |
| Validation | O(m log m) | sort per resource + linear overlap sweep |
| **Space** | O(n · D + m) | domains + placed interviews |

**Honest summary:** the exact problem (scheduling with resource constraints) is **NP-hard** in general, so a guaranteed-optimal solver would be exponential. Recruitly instead runs a **polynomial heuristic (greedy + MRV, ~O(n²·D·C))** and spends a **bounded** amount of extra effort on backtracking only when the heuristic leaves people out. Measured growth is in the benchmarks below.

---

## 📊 Benchmarks

> 🖥️ Measured with `npm run bench` — Node 24, single thread, **median of 5 runs**, solve time only (excludes DB). Times will differ on other machines — re-run the command to reproduce.
>
> ✅ **Valid = true in every row**: the independent validator found **zero** hard-constraint violations in every produced schedule.

### 📈 Scale

| Scenario | Candidates | Scheduled | Status | Solve time | Quality |
|---|---:|---:|---|---:|---:|
| 3 interviewers, 2 rooms | 20 | 20 | ✅ complete | ~18 ms | 97.2 |
| 6 interviewers, 4 rooms *(demo size)* | 60 | 60 | ✅ complete | ~153 ms | 98.1 |
| 10 interviewers, 6 rooms | 150 | 150 | ✅ complete | ~1.06 s | 97.7 |
| 15 interviewers, 8 rooms | 300 | 240 | 🟡 partial (capacity-bound*) | ~9.4 s | 91.7 |
15 interviewers × 8 interviews/day × 2 days = **240** interviews of capacity, so 240 is the maximum possible — the engine placed every interview that physically fits and explained the rest as `daily_capacity`.

**Reading the numbers:** time grows faster than linearly with n (20→60 candidates is ×3 but ~×8.6 time; 60→150 is ×2.5 but ~×6.9) — consistent with the O(n²) MRV recount. Comfortable up to a few hundred candidates per round; beyond that, schedule in batches by round or by day. ⚠️ The 300-candidate run is slower than the default 4 s search budget because the budget covers the search phase only; explanation generation for unplaced candidates adds to total time.
### 🧨 Edge-case conflict resolution

Each case is built to be unsolvable or tricky. The engine must **never** return an invalid schedule and must **name the real cause**.

| # | Edge case | Placed / Total | Status | Reported cause | Time |
|---|---|---:|---|---|---:|
| 1 | No interviewer has the required skill | 0 / 10 | ⛔ infeasible | `no_qualified_interviewer` | 0.3 ms |
| 2 | Demand exceeds capacity (30 candidates, 1 interviewer, 8/day) | 16 / 30 | 🟡 partial | `daily_capacity` | 25 ms |
| 3 | Candidates free only 1 hour, 1 interviewer | 2 / 8 | 🟡 partial | `interviewer_busy` | 0.4 ms |
| 4 | Offline-only policy but zero rooms | 0 / 10 | ⛔ infeasible | `no_room` | 1.3 ms |
| 5 | Panel of 2 but only 1 qualified interviewer | 0 / 6 | ⛔ infeasible | `insufficient_qualified_interviewers` | 0.2 ms |
| 6 | Prerequisite round not passed | 0 / 6 | ⛔ infeasible | `prerequisite_not_met` | ~0 ms |
| 7 | One room, all offline, 12 candidates, 3 interviewers | 12 / 12 | ✅ complete | — (room time-shared) | 9.5 ms |
| 8 | Tight puzzle: 24 candidates, 2 interviewers, 3-hour window | 12 / 24 | 🟡 partial | `interviewer_busy` | 443 ms |

**What this shows**

- ⚡ **Structural impossibilities are detected in ~1 ms** (cases 1, 4, 5, 6) — the engine proves them up front instead of searching.
- 🧮 **Capacity limits are recognised exactly** (cases 2, 3, 8: the placed count equals the true maximum — 16, 2 and 12).
- 🔍 **Case 8 uses the full DFS budget** (20 000 nodes, ~0.4 s) because no counting proof applies — a deliberate demonstration of the bounded-search guarantee.
- 🛡️ **Zero hard-constraint violations** across all 12 benchmark runs.

Reproduce: add `"bench": "node benchmarks/benchmark.js"` to the `scripts` in `server/package.json`, put `benchmark.js` in `server/benchmarks/`, then run `cd server && npm run bench`

---

## ♻️ Conflict Resolution in Rescheduling

When an interviewer becomes unavailable, `rescheduleEngine` computes the **smallest change set**, in this order of preference:

1. 🔁 **Substitute** another qualified interviewer in the *same slot* (nothing moves)
2. 🕐 **Move** to the nearest feasible slot, keeping mode and room where possible
3. 📨 **Needs rebooking** — candidate gets a fresh self-booking link
4. 👀 **Manual review** — evaluated or started interviews are *never* changed automatically

The coordinator sees a **preview with before/after and reason**, approves, and the plan signature is re-checked at apply time so a stale plan can never be applied.

---

## 🔌 Tool & AI Disclosure

Transparency about what was used to build this project:

| Tool | Used for |
|---|---|
| 🤖 **Claude (Anthropic)** | Defined the problem, requirements and feature scope, Generated first drafts of code and boilerplate from our specification, Chose the architecture and stack (React, Express, PostgreSQL), Suggested options for the scheduling approach, which we reviewed and chose from |
| 🧩 **Libraries** | Open-source packages listed in `package.json` (Express, React, Vite, Tailwind, FullCalendar, Recharts, pg, Zod, Socket.IO, Nodemailer, googleapis, bcrypt, etc.) |
| 🗄️ **PostgreSQL** | Data storage and the overlap-prevention constraints |
| 📧 **Google APIs / SMTP** | *Optional.* Without credentials the app runs in demo mode: emails are recorded as `logged_only` and no fake meeting links are ever generated |

---
## 👩‍💻 Team

Build by team procrastiDuo

--- 

⭐ If you like this project, please star the repo!
