# Clinical Trial Retention Agent — Next Steps

> **Purpose:** Prioritised roadmap for what to build next, organised by theme. Items marked 🔴 are blockers for a real pilot; 🟡 are important for a credible demo; 🟢 are longer-term.

---

## 1. Fix & Stabilise the Deployed Demo (This Week)

| Priority | Item | Detail |
|---|---|---|
| 🔴 | **Fix Railway session creation crash** | The `POST /api/session` endpoint returns 500 on Railway. Root cause is likely the `@ibm-cloud/watsonx-ai` SDK failing at module-load time in the Railway environment even when mock mode is active. Solution: move the SDK require() fully behind the `useMock` guard so it is never imported unless watsonx credentials are present. |
| 🔴 | **Add `/api/health` endpoint** | Returns `{ status: "ok", mode: "mock" | "live" }` — lets Railway health checks pass and makes it easy to confirm what mode the server is in without digging into logs. |
| 🟡 | **Show participant names in chat header** | Currently the context bar shows the full trial name but not the participant's name prominently enough for a demo audience. |
| 🟡 | **Persist sessions across server restarts** | Sessions are in-memory and lost on every Railway redeploy. For the demo, pre-seed one open session per participant so teammates can jump straight into the conversation. |

---

## 2. Complete the Agentic Loop (Next Sprint)

The five-stage loop (Receive → Plan → Execute → Monitor → Escalate) is scaffolded but Monitor is not surfaced in the UI.

| Priority | Item | Detail |
|---|---|---|
| 🔴 | **Monitor dashboard — `/api/status/:participantId`** | Returns visit status, reschedule count used vs. allowed, any open reimbursements, and any pending escalations. Gives coordinators a live view without entering the chat. |
| 🔴 | **Out-of-window escalation flow** | When `checkVisitWindow` returns `withinWindow: false`, the mock LLM currently has no branch for it. Add a path that calls `escalateToCoordinator` automatically and tells the participant a coordinator will follow up. |
| 🟡 | **Proactive reminder sending** | Add a background job (simple `setInterval` on startup) that checks upcoming visits and fires `sendReminder` 7, 3, and 1 day before — without waiting for the participant to ask. |
| 🟡 | **Missed visit detection** | If a visit's `scheduledDateTime` passes and `status` is still `'scheduled'`, automatically flag it as `'missed'` and escalate to the coordinator. |

---

## 3. Human-in-the-Loop Enhancements

The travel booking gate (`getTravelOptions` → `confirmTravel`) is working. These items extend the same pattern to other high-stakes actions.

| Priority | Item | Detail |
|---|---|---|
| 🔴 | **Coordinator approval UI** | A separate `/coordinator` view (password-protected) that lists pending escalations and allows the coordinator to approve or reject them directly in the browser — replacing the current email-only notification. |
| 🟡 | **Reimbursement approval gate** | Mirror the travel gate: `previewReimbursement` (shows calculated amount) → `submitReimbursement` (requires `humanConfirmed: true`). Prevents the agent from filing inaccurate amounts. |
| 🟡 | **Spending cap enforcement** | Add a per-session `totalSpendUsd` accumulator. If a booking would push the session over a configurable limit (e.g. $500), require coordinator approval before proceeding. |
| 🟢 | **Audit log** | Append every tool execution (input, output, timestamp, sessionId) to a persistent log file or database. Required for regulatory compliance in a real trial. |

---

## 4. Live LLM Integration (Before Pilot)

The mock LLM covers the demo scenario but cannot handle free-form participant conversations.

| Priority | Item | Detail |
|---|---|---|
| 🔴 | **Connect IBM watsonx** | Set `WATSONX_API_KEY`, `WATSONX_PROJECT_ID`, and `WATSONX_URL` as Railway environment variables. The `WatsonxLlmClient` is already implemented — just needs credentials. |
| 🔴 | **Test tool-calling with Granite** | Verify `ibm/granite-3-8b-instruct` reliably calls `checkVisitWindow` before `rescheduleVisit`, and never sets `humanConfirmed: true` without participant approval. Add evaluation prompts for each failure mode. |
| 🟡 | **Fallback to mock on LLM timeout** | If the watsonx call times out or returns a 5xx, fall back to the scripted mock response so the demo never shows a blank screen. |
| 🟡 | **Prompt tuning for edge cases** | Test: participant asks a medical question, participant tries to reschedule outside window, participant disputes a reimbursement amount. Adjust the system prompt guardrails based on observed failures. |

---

## 5. Data & Integration Layer (Pilot Readiness)

Currently all data is in-memory seed data. A real pilot needs persistent storage and system integrations.

| Priority | Item | Detail |
|---|---|---|
| 🔴 | **Replace in-memory seed with a database** | Migrate `PARTICIPANTS`, `TRIALS`, `rescheduleCount`, `reimbursements`, and `escalations` to a Postgres or SQLite database. Railway provides a Postgres plugin. |
| 🔴 | **Multi-participant / multi-trial support** | The seed has two participants and one trial. The data model already supports many-to-one (participant → trial) — just needs more seed rows and a participant auth/lookup mechanism. |
| 🟡 | **CTMS read integration** | Replace the seed store with a read-only API call to a CTMS (Clinical Trial Management System) to fetch real visit schedules. Keep write-through out of scope until accuracy is proven. |
| 🟡 | **Real SMS via Twilio or AWS SNS** | The `sendReminder` tool already supports `channel: 'sms'`. Wire it to a provider. Requires a phone number per participant in the seed data. |
| 🟢 | **Email via SendGrid or SES** | Same as SMS — the email channel in `sendReminder` currently just logs to console. |

---

## 6. Security & Compliance (Before Any Real Participant Data)

| Priority | Item | Detail |
|---|---|---|
| 🔴 | **Participant authentication** | The current UI lets anyone select any participant with no login. Add a PIN or magic-link flow so only the actual participant can access their session. |
| 🔴 | **HTTPS everywhere** | Railway provides this automatically on the generated domain — confirm TLS is enforced and no HTTP fallback exists. |
| 🔴 | **No PII in logs** | Audit all `console.log` and `console.error` calls to ensure participant names, emails, and phone numbers are not written to plain-text logs. |
| 🟡 | **Session expiry** | Sessions currently live forever in the in-memory map. Add a 30-minute inactivity timeout with a clear message to the participant. |
| 🟢 | **HIPAA / IRB review** | Before handling real health data, engage legal/compliance for a HIPAA Business Associate Agreement with any vendor (Railway, IBM, Twilio) and obtain IRB approval for the participant-facing tool. |

---

## 7. UI / UX Polish

| Priority | Item | Detail |
|---|---|---|
| 🟡 | **Mobile-responsive layout** | The current UI is designed for desktop. Many participants will access via phone. Test and fix on 375px viewport. |
| 🟡 | **Visit summary card on load** | After selecting a participant, show their next visit (date, location, status) as a card at the top of the chat — so participants immediately see what the agent knows about them. |
| 🟡 | **Suggested quick replies** | Below the agent's first message, show tappable chips: "Reschedule a visit", "Check travel options", "Track reimbursement". Reduces friction for non-technical users. |
| 🟡 | **Tool execution panel off by default** | Currently tool calls are visible (collapsed). For a non-technical demo audience, hide them behind an "Advanced / Developer" toggle so the UI looks cleaner. |
| 🟢 | **Multi-language support** | The deck specifies English only for MVP. Post-MVP: add Spanish and Mandarin via i18n strings + a translated system prompt. |

---

## 8. Demo & Presentation

| Priority | Item | Detail |
|---|---|---|
| 🟡 | **Build the PPTX update** | Use `CHANGES.md` as the brief. Add four slides: updated "How It Works", "Human-in-the-Loop Travel Booking", "Live Prototype", "Tech Stack + Test Coverage". |
| 🟡 | **QR code for live demo** | Generate a QR code pointing to `https://bob-demo-production.up.railway.app` to show on the "Live Prototype" slide. |
| 🟡 | **Re-record demo video** | Once the Railway deploy is stable, re-record `dist/demo-recording.webm` using `npm run record` with the full 4-turn flow (conflict → reschedule → travel options → human confirms → reimbursement). |
| 🟢 | **Second participant demo path** | The James Okafor (Philadelphia → NYC, rideshare) path works in code but is not shown in the demo script. Add a second demo scenario that shows the rideshare + hotel flow. |
