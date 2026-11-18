/**
 * @file captureTranscript.ts
 * Runs the scheduling-conflict demo and writes a structured JSON transcript
 * to dist/transcript.json for use by the HTML terminal replay renderer.
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { PARTICIPANTS, TRIALS } from './data/seed';
import { createLlmClient } from './agent/llmClient';
import { createSession } from './agent/runner';
import { AgentContext } from './types';

// ---------------------------------------------------------------------------
// Transcript event types
// ---------------------------------------------------------------------------

type EventKind =
  | 'header'
  | 'context'
  | 'participant'
  | 'agent-think'
  | 'tool-call'
  | 'tool-result'
  | 'agent-reply'
  | 'footer';

interface TranscriptEvent {
  kind: EventKind;
  text?: string;
  label?: string;
  data?: unknown;
  /** Delay in ms before this event is rendered (for animation pacing) */
  delay: number;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const participant = PARTICIPANTS['P-1042'];
  const trial = TRIALS['ONCO-2024-001'];

  if (!participant || !trial) {
    console.error('Seed data missing');
    process.exit(1);
  }

  const context: AgentContext = { participant, trial };
  const llm = createLlmClient();
  const session = createSession(context, llm);

  const events: TranscriptEvent[] = [];

  // Header
  events.push({ kind: 'header', text: 'Clinical Trial Retention Agent', delay: 0 });
  events.push({
    kind: 'context',
    text: `Participant: ${participant.firstName} ${participant.lastName}  |  Trial: ${trial.trialName}`,
    delay: 600,
  });
  events.push({
    kind: 'context',
    text: `Next visit: ${participant.upcomingVisits[0].visitId} on ${participant.upcomingVisits[0].scheduledDateTime}`,
    delay: 400,
  });

  // Dialogue turns
  const turns: Array<{ user: string; label: string }> = [
    {
      label: 'Maria reports a scheduling conflict',
      user: "Hi, I have a conflict on November 15th and can't make my appointment. Can I move it to November 18th?",
    },
    {
      label: 'Maria confirms and mentions she will drive',
      user: 'Yes please, November 18th at 9 AM works great. I will drive myself.',
    },
    {
      label: 'Maria asks about reimbursement',
      user: 'How do I get reimbursed for my drive? I will be coming about 25 miles.',
    },
  ];

  let cumulativeDelay = 1200;

  for (const turn of turns) {
    // Section label
    events.push({ kind: 'header', text: `— ${turn.label} —`, delay: cumulativeDelay });
    cumulativeDelay = 800;

    // Participant message
    events.push({
      kind: 'participant',
      label: `${participant.firstName} ${participant.lastName}`,
      text: turn.user,
      delay: 600,
    });

    // Agent thinking indicator
    events.push({ kind: 'agent-think', text: 'Agent thinking…', delay: 800 });

    // Run the turn
    const result = await session.chat(turn.user);

    // Tool executions
    for (const exec of result.toolExecutions) {
      events.push({
        kind: 'tool-call',
        label: exec.toolName,
        data: exec.input,
        delay: 500,
      });
      events.push({
        kind: 'tool-result',
        label: exec.toolName,
        data: exec.output,
        delay: 400,
      });
    }

    // Agent reply
    events.push({
      kind: 'agent-reply',
      text: result.response,
      delay: 600,
    });
  }

  // Footer
  events.push({
    kind: 'footer',
    text: `Session complete  |  Session ID: ${session.sessionId}`,
    delay: 1000,
  });

  // Write output
  const outDir = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'transcript.json');
  fs.writeFileSync(outPath, JSON.stringify(events, null, 2), 'utf8');
  console.log(`Transcript written to ${outPath} (${events.length} events)`);
}

main().catch((err) => {
  console.error('Error capturing transcript:', err);
  process.exit(1);
});
