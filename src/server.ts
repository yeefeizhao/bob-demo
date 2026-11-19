/**
 * @file server.ts
 * Local Express server that exposes the Clinical Trial Retention Agent
 * via a REST API and serves the web chat UI.
 *
 * Usage:
 *   npx ts-node src/server.ts
 *   (or: npm run serve)
 *
 * Endpoints:
 *   GET  /api/health              – status + which LLM backend is active
 *   GET  /api/participants        – list available participants
 *   POST /api/session             – create a new agent session
 *   POST /api/session/:id/chat    – send a message to an existing session
 *   GET  /                        – serve the web UI
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as path from 'path';
import express, { Request, Response } from 'express';
import { PARTICIPANTS, TRIALS } from './data/seed';
import { createLlmClient, llmMode, llmModelName } from './agent/llmClient';
import { createSession, AgentSession } from './agent/runner';
import { AgentContext } from './types';

const app = express();
app.use(express.json());

// Serve the static web UI from src/web/
app.use(express.static(path.join(__dirname, 'web')));

// In-memory session store: sessionId → AgentSession
const sessions = new Map<string, AgentSession>();

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

/** Reports which LLM backend is active so the UI can show demo vs live mode. */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, llm: llmMode(), model: llmModelName() });
});

// ---------------------------------------------------------------------------
// GET /api/participants
// ---------------------------------------------------------------------------

/**
 * Returns the list of participants and their upcoming visits so the UI
 * can let the user pick who they are chatting as.
 */
app.get('/api/participants', (_req: Request, res: Response) => {
  const list = Object.values(PARTICIPANTS).map((p) => ({
    participantId: p.participantId,
    name: `${p.firstName} ${p.lastName}`,
    homeCity: p.homeCity,
    homeState: p.homeState,
    trialId: p.enrolledTrialId,
    trialName: TRIALS[p.enrolledTrialId]?.trialName ?? p.enrolledTrialId,
    upcomingVisits: p.upcomingVisits.map((v) => ({
      visitId: v.visitId,
      visitType: v.visitType,
      scheduledDateTime: v.scheduledDateTime,
      status: v.status,
      siteLocation: v.siteLocation,
    })),
  }));
  res.json(list);
});

// ---------------------------------------------------------------------------
// POST /api/session
// ---------------------------------------------------------------------------

/**
 * Creates a new agent session for the given participant.
 * Body: { participantId: string }
 */
app.post('/api/session', (req: Request, res: Response) => {
  try {
    const { participantId } = req.body as { participantId?: string };

    if (!participantId) {
      res.status(400).json({ error: 'participantId is required' });
      return;
    }

    const participant = PARTICIPANTS[participantId];
    if (!participant) {
      res.status(404).json({ error: `Participant ${participantId} not found` });
      return;
    }

    const trial = TRIALS[participant.enrolledTrialId];
    if (!trial) {
      res.status(404).json({ error: `Trial ${participant.enrolledTrialId} not found` });
      return;
    }

    const context: AgentContext = { participant, trial };
    const llm = createLlmClient();
    const session = createSession(context, llm);
    sessions.set(session.sessionId, session);

    res.json({ sessionId: session.sessionId, participantId, trialName: trial.trialName });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[server] /api/session error:', message);
    res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/session/:id/chat
// ---------------------------------------------------------------------------

/**
 * Sends a user message to an existing session and returns the agent response
 * plus any tool executions that happened during this turn.
 * Body: { message: string }
 */
app.post('/api/session/:id/chat', async (req: Request, res: Response) => {
  const session = sessions.get(String(req.params.id));
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { message } = req.body as { message?: string };
  if (!message || message.trim() === '') {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const result = await session.chat(message.trim());
    res.json({
      response: result.response,
      toolExecutions: result.toolExecutions,
    });
  } catch (err) {
    console.error('[server] chat error:', err);
    res.status(500).json({ error: 'Agent error — see server logs' });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3000);
// Bind to 0.0.0.0 so the server is reachable on Railway and other cloud hosts.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Clinical Trial Retention Agent — Web UI`);
  console.log(`  http://localhost:${PORT}`);
  console.log(
    `  LLM backend: ${llmMode()} (${llmModelName()})${llmMode() === 'mock' ? ' - set GROQ_API_KEY (free) or watsonx keys for live mode' : ''}\n`
  );
});
