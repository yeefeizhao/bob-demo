# Clinical Trial Retention Agent — What Changed Since the Product Deck

> **Purpose:** This document summarises every implementation decision made after the original "Product: How It Works" slide deck (slide 5). Use it as the basis for a PPTX update showing what has been built, what was added beyond the plan, and what remains.

---

## 1. What the Deck Described vs. What Was Built

The deck defined a five-stage agentic loop across two dimensions: **functional stages** (Receive → Plan → Execute → Monitor → Escalate) and **guardrails** (Human Oversight + MVP Scope). Every stage and guardrail is now implemented in code.

### 1.1 Receive
> *"Visit schedule, requests, trial rules"*

**Built:**
- In-memory participant and trial database (`src/data/seed.ts`) seeded with two real participants (Maria Santos, James Okafor) enrolled in trial `LUMINA-2: Adjuvant Immunotherapy in Stage III NSCLC`.
- Each participant has upcoming visits with full protocol metadata: `visitId`, `scheduledDateTime`, `siteLocation`, `estimatedTravelMinutes`, and a `window` (earliest / target / latest dates).
- Trial rules are stored per-trial: `maxReschedulesPerVisit`, `mileageRateUsd`, `hotelRateUsd`, `coordinatorEmail`.
- A system prompt (`src/agent/systemPrompt.ts`) is injected at session start with the participant name, trial name, and coordinator contact — giving the LLM full context before the first message.

---

### 1.2 Plan
> *"Check requirements and availability"*

**Built — `checkVisitWindow` tool:**
- Before any reschedule, the agent calls `checkVisitWindow` to verify the proposed date falls within the protocol-defined window (`earliestDate` → `latestDate`).
- Returns `withinWindow` (boolean), remaining reschedule count, and a human-readable message.
- The tool description is worded so the LLM **always** calls it first — it cannot call `rescheduleVisit` without a prior `checkVisitWindow`.

---

### 1.3 Execute
> *"Book, reschedule, reimburse"*

**Built — four execution tools:**

| Tool | What it does |
|---|---|
| `rescheduleVisit` | Moves a visit to a new date/time within the protocol window. Increments the reschedule counter and returns a `RSC-XXXXXXXX` confirmation code. |
| `getTravelOptions` | **New — not in the original deck.** Returns cost estimates (transit / rideshare / flight) without booking anything. Must be shown to the participant before any booking. |
| `confirmTravel` | **New — not in the original deck.** Books the selected option only when `humanConfirmed=true`. Hard-blocks booking if the flag is missing. Returns `TRV-` and `HTL-` confirmation codes. |
| `trackReimbursement` | Submits a mileage and/or hotel reimbursement request. Calculates amount using per-trial rates and returns a `RMB-XXXXXXXX` reference number. |
| `sendReminder` | Sends an email or SMS reminder N days before the visit. |

**Key addition beyond the deck — two-step travel booking:**
The original deck described "Book" as a single step. The implementation splits this into `getTravelOptions` (read-only, shows options + costs to the participant) followed by `confirmTravel` (requires explicit human approval). This directly implements the "Coordinator approves bookings until accuracy is proven" MVP Scope guardrail.

---

### 1.4 Monitor
> *"Track completion and missed tasks"*

**Built:**
- All reschedules are tracked in an in-memory `rescheduleCount` ledger keyed by `participantId:visitId`.
- All reimbursements are appended to a `reimbursements` array with status, amount, and timestamp.
- All escalations are logged to an `escalations` array with urgency and reason.
- Visit status is updated to `'rescheduled'` on successful reschedule — readable by any subsequent query.

**Noted as future work for PPTX:** A monitoring dashboard view (missed visit alerts, overdue reimbursements) is not yet exposed via the API or UI — data is tracked in-memory only.

---

### 1.5 Escalate
> *"Alert coordinator when needed"*

**Built — `escalateToCoordinator` tool:**
- Creates an escalation record with `low / medium / high` urgency.
- Returns the coordinator's email and an `ESC-XXXXXXXX` reference.
- The system prompt instructs the agent to escalate for: out-of-window reschedule requests, payment disputes, and participant safety concerns.
- `rescheduleVisit` itself returns a failure + recommendation to escalate when the protocol window is exceeded.

---

## 2. Human Oversight and Guardrails — Implemented

The deck listed three guardrails. All three are enforced in code, with one additional guardrail added during implementation.

| Guardrail (deck) | Implementation |
|---|---|
| **Protocol-aware** — actions must comply with participant's approved trial schedule | `checkVisitWindow` is called before every reschedule; `rescheduleVisit` hard-rejects out-of-window dates even if the LLM tries to skip the check. |
| **Consent and privacy** — access only the data needed for the task | Each session is scoped to a single participant. The server (`src/server.ts`) creates one `AgentSession` per participant and there is no cross-participant data access. |
| **Clear boundaries** — logistics and retention only, not medical advice | The system prompt explicitly prohibits medical advice, clinical decisions, and protocol changes. The agent is instructed to redirect clinical questions to the trial physician. |
| **Travel spending cap (new)** — the agent cannot autonomously spend money | `getTravelOptions` is read-only. `confirmTravel` requires `humanConfirmed: true`, which the LLM is instructed never to set without explicit participant approval in the conversation. The tool itself hard-blocks any booking if the flag is false. |

---

## 3. MVP Scope — Status

| MVP Criterion (deck) | Status |
|---|---|
| **Setting:** one Phase II–III oncology trial across 2–3 sites | ✅ One Phase II trial (`LUMINA-2`) with two participant records across one site (NYU Langone). |
| **Channel:** SMS and web chat, English only | ✅ Web chat via the hosted web UI (`src/web/index.html`). SMS channel is modelled (`sendReminder` supports `'sms'`) but not wired to a real SMS provider. |
| **Systems:** read-only scheduling; runs through existing vendors | ✅ All scheduling reads from the in-memory seed store. No write-through to external CTMS/EDC — prototype only. |
| **Control:** coordinator approves bookings until accuracy is proven | ✅ Implemented via the two-step `getTravelOptions` → `confirmTravel` flow with `humanConfirmed` gate. |

---

## 4. New Things Added Beyond the Original Deck

These items were not described in the slide but were built as part of the working prototype:

### 4.1 Web Chat Interface
- A browser-based chat UI (`src/web/index.html`) served by a local/cloud Express server.
- Participant selector screen with name, home city, trial, and next visit date.
- Real-time typing indicator and collapsible tool execution panels showing exact JSON inputs/outputs.
- Deployed at **https://bob-demo-production.up.railway.app** via Railway (auto-deploys on `git push`).

### 4.2 REST API
Three endpoints (`src/server.ts`):
- `GET /api/participants` — lists available participants for the session selector.
- `POST /api/session` — creates a new agent session scoped to one participant.
- `POST /api/session/:id/chat` — sends a message and returns the agent response + tool executions.

### 4.3 Two-Step Travel Booking (Human-in-the-Loop)
Not in the original deck. Splits the former single `arrangeTravel` tool into:
1. `getTravelOptions` — read-only cost estimate, shown to participant before any spend.
2. `confirmTravel` — actual booking, only triggered after explicit participant approval.

This directly implements the "Control" MVP guardrail at the code level, not just the prompt level.

### 4.4 Context-Aware Mock LLM
A scripted `MockLlmClient` drives the full demo conversation without requiring IBM watsonx credentials. It is history-aware (reads prior tool calls from the conversation rather than a step counter) so it correctly handles both participants and all conversation branches.

### 4.5 Test Suite
29 unit tests covering all 7 tools (`src/tools/index.test.ts`) and the agent runner (`src/agent/runner.test.ts`). All pass.

### 4.6 Demo Recording
An animated terminal replay (`dist/demo-replay.html` + `dist/demo-recording.webm`) baked from a live mock session, showing the full Receive → Plan → Execute flow including the new human-confirmation travel step.

---

## 5. What to Add to the PPTX

Suggested new or updated slides based on the above:

| Slide | Suggested title | Key content |
|---|---|---|
| Update slide 5 | **Product: How It Works** | Add `getTravelOptions` → `confirmTravel` as an explicit two-step under Execute; add "Web Chat" under Channel |
| New slide | **Human-in-the-Loop: Travel Booking** | Diagram: agent presents options → participant approves → agent books. Show the `humanConfirmed` gate. Screenshots of the UI approval flow. |
| New slide | **Live Prototype** | QR code / URL to `https://bob-demo-production.up.railway.app`. Screenshot of chat UI. Show tool execution panel. |
| New slide | **Tech Stack** | TypeScript + Node.js, Express API, IBM watsonx LLM (mock mode for demo), deployed on Railway, 29 unit tests passing. |
| Update scope slide | **MVP Scope — Status** | Mark each criterion green/amber/red using the table in section 3 above. Note SMS is modelled but not wired. |
