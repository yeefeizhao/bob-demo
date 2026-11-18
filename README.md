# Clinical Trial Retention Agent — Prototype

> NYU Stern × IBM watsonx AI Labs Capstone — Orange Team

A TypeScript prototype of the scheduling-conflict use case described in the pitch deck.
The agent receives a participant's conflict, checks the protocol visit window, reschedules the visit, arranges travel, and confirms reimbursement — all in a single conversational session.

---

## Architecture

```
src/
├── types.ts                  # All shared domain types (Participant, Trial, Visit, tool I/O)
├── data/
│   └── seed.ts               # In-memory participant + trial data (replaces real CTMS/EDC)
├── tools/
│   ├── index.ts              # All 6 agent tool implementations
│   └── index.test.ts         # Unit tests for every tool
├── agent/
│   ├── systemPrompt.ts       # System prompt with guardrails
│   ├── toolDefinitions.ts    # JSON Schema definitions passed to the LLM
│   ├── llmClient.ts          # LLM wrapper: MockLlmClient + WatsonxLlmClient
│   ├── runner.ts             # Agentic loop (Receive → Plan → Execute → Monitor → Escalate)
│   └── runner.test.ts        # Unit tests for the runner
├── demo.ts                   # CLI demo of the full scheduling-conflict scenario
└── index.ts                  # Public exports
```

The agent implements the 5-step loop from slide 5 of the deck:

| Step | What it does |
|------|-------------|
| **Receive** | Participant sends a message (conflict, question, request) |
| **Plan** | LLM selects which tool to call based on system prompt + context |
| **Execute** | Runner dispatches the tool; result is appended to history |
| **Monitor** | Loop continues until `finishReason === 'stop'` |
| **Escalate** | `escalateToCoordinator` tool fires when the agent cannot resolve autonomously |

---

## Quick start

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9

```bash
# Install dependencies
npm install

# Copy env template
cp .env.example .env

# Run the offline demo (no credentials needed)
npm run demo

# Run tests
npm test
```

### Live watsonx AI
1. Create an IBM Cloud account and provision a watsonx.ai service.
2. Get your API key, project ID, and service URL.
3. Edit `.env` and set `MOCK_LLM=false` plus the three `WATSONX_*` vars.
4. `npm run demo`

---

## Agent tools

| Tool | Purpose |
|------|---------|
| `checkVisitWindow` | Verify a proposed date is inside the protocol window |
| `rescheduleVisit` | Move a visit to the new date and update status |
| `arrangeTravel` | Book rideshare / transit / flight + optional hotel |
| `trackReimbursement` | Submit mileage and hotel reimbursement claims |
| `escalateToCoordinator` | Notify the site coordinator of out-of-bounds situations |
| `sendReminder` | Send email or SMS reminder to the participant |

---

## Guardrails

- No medical advice — the agent refuses any clinical questions.
- Protocol-aware — always calls `checkVisitWindow` before rescheduling.
- Consent-scoped — seed data is partitioned per participant; cross-access is impossible.
- Max 10 tool-call rounds per turn to prevent runaway loops.

---

## Next steps (from pitch deck)

1. **Replace seed data** with real CTMS/EDC API adapters (Veeva Vault, Oracle Clinical One, Suvoda).
2. **Add Suvoda / Mural Health tool** for payment disbursement.
3. **Wrap in an Express server** to expose a `/chat` REST endpoint for a mobile-friendly UI.
4. **Add watsonx Orchestrate** multi-agent orchestration for multi-trial / multi-participant scenarios.
5. **Compliance hardening** — HIPAA audit logging, consent management, IRB traceability.
