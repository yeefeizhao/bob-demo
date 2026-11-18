/**
 * @file demo.ts
 * Interactive CLI demo of the scheduling-conflict use case described
 * in the pitch deck (slide 3). Runs fully offline with MOCK_LLM=true.
 *
 * Usage:
 *   npx ts-node src/demo.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { PARTICIPANTS, TRIALS } from './data/seed';
import { createLlmClient } from './agent/llmClient';
import { createSession } from './agent/runner';
import { AgentContext } from './types';

// ANSI colour helpers
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
};

function header(text: string): void {
  console.log(`\n${C.bold}${C.cyan}${'─'.repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${text}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${'─'.repeat(60)}${C.reset}\n`);
}

function participantSays(name: string, text: string): void {
  console.log(`${C.green}${C.bold}👤 ${name}:${C.reset} ${text}`);
}

function agentSays(text: string): void {
  console.log(`\n${C.magenta}${C.bold}🤖 Agent:${C.reset} ${text}\n`);
}

function toolLog(name: string, output: unknown): void {
  console.log(
    `${C.dim}  [tool: ${name}]${C.reset} ${C.yellow}${JSON.stringify(output, null, 2)
      .split('\n')
      .join('\n  ')}${C.reset}`
  );
}

// ---------------------------------------------------------------------------
// Demo script
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  header('Clinical Trial Retention Agent — Demo (Scheduling Conflict)');

  // Load context
  const participant = PARTICIPANTS['P-1042'];
  const trial = TRIALS['ONCO-2024-001'];

  if (!participant || !trial) {
    console.error('Seed data not found. Check src/data/seed.ts');
    process.exit(1);
  }

  console.log(`${C.bold}Participant:${C.reset}  ${participant.firstName} ${participant.lastName}`);
  console.log(`${C.bold}Trial:${C.reset}        ${trial.trialName}`);
  console.log(`${C.bold}Upcoming visit:${C.reset} ${participant.upcomingVisits[0].visitId} on ${participant.upcomingVisits[0].scheduledDateTime}`);
  console.log();

  const context: AgentContext = { participant, trial };
  const llm = createLlmClient();
  const session = createSession(context, llm);

  // --- Turn 1: participant reports a scheduling conflict ---
  const turn1Message =
    "Hi, I have a conflict on November 15th and can't make my appointment. Can I move it to November 18th?";

  participantSays(participant.firstName, turn1Message);

  const turn1 = await session.chat(turn1Message);

  for (const exec of turn1.toolExecutions) {
    toolLog(exec.toolName, exec.output);
  }
  agentSays(turn1.response);

  // --- Turn 2: participant confirms the new date; agent fetches travel options ---
  const turn2Message = 'Yes please, November 18th at 9 AM works great. I will drive myself.';
  participantSays(participant.firstName, turn2Message);

  const turn2 = await session.chat(turn2Message);

  for (const exec of turn2.toolExecutions) {
    toolLog(exec.toolName, exec.output);
  }
  agentSays(turn2.response);

  // --- Turn 3: human explicitly approves the travel options ---
  const turn3Message = 'Yes, please go ahead and book the transit option.';
  participantSays(participant.firstName, turn3Message);

  const turn3 = await session.chat(turn3Message);

  for (const exec of turn3.toolExecutions) {
    toolLog(exec.toolName, exec.output);
  }
  agentSays(turn3.response);

  // --- Turn 4: request reimbursement ---
  const turn4Message = 'How do I get reimbursed for my drive? I will be coming about 25 miles.';
  participantSays(participant.firstName, turn4Message);

  const turn4 = await session.chat(turn4Message);

  for (const exec of turn4.toolExecutions) {
    toolLog(exec.toolName, exec.output);
  }
  agentSays(turn4.response);

  header('Demo complete');
  console.log(`${C.dim}Session ID: ${session.sessionId}${C.reset}`);
  console.log(`${C.dim}Total turns: 4 | Tools executed: ${
    turn1.toolExecutions.length + turn2.toolExecutions.length +
    turn3.toolExecutions.length + turn4.toolExecutions.length
  }${C.reset}\n`);
}

main().catch((err) => {
  console.error('Demo error:', err);
  process.exit(1);
});
