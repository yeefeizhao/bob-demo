/**
 * @file agent/runner.ts
 * Agent runner: orchestrates the Receive → Plan → Execute → Monitor → Escalate
 * loop described in the pitch deck using an LLM with tool-calling.
 *
 * Deterministic guardrails (see guardrails.ts) wrap the LLM so that safety
 * rules hold regardless of which model backend is used.
 */

import { v4 as uuidv4 } from 'uuid';
import { Message, AgentContext } from '../types';
import { TOOL_DEFINITIONS } from './toolDefinitions';
import { LlmClient } from './llmClient';
import { buildSystemPrompt } from './systemPrompt';
import {
  screenInput,
  emergencyReply,
  medicalReply,
  checkBookingApproval,
  screenOutput,
} from './guardrails';
import {
  checkVisitWindow,
  rescheduleVisit,
  getTravelOptions,
  confirmTravel,
  trackReimbursement,
  escalateToCoordinator,
  sendReminder,
} from '../tools';

/** Maximum tool-call rounds before the agent stops to avoid infinite loops. */
const MAX_ROUNDS = 8;

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatches a tool call by name to its implementation.
 * Throws on unknown tools or bad input; the caller turns that into a tool
 * error result the model can recover from.
 */
function dispatchTool(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'checkVisitWindow':
      return checkVisitWindow(args as never);
    case 'rescheduleVisit':
      return rescheduleVisit(args as never);
    case 'getTravelOptions':
      return getTravelOptions(args as never);
    case 'confirmTravel':
      return confirmTravel(args as never);
    case 'trackReimbursement':
      return trackReimbursement(args as never);
    case 'escalateToCoordinator':
      return escalateToCoordinator(args as never);
    case 'sendReminder':
      return sendReminder(args as never);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function defaultVisitId(context: AgentContext): string {
  return (
    context.activeVisitId ??
    context.participant.upcomingVisits.find((v) => v.status === 'scheduled')?.visitId ??
    context.participant.upcomingVisits[0]?.visitId ??
    ''
  );
}

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

export interface TurnResult {
  /** Final text response from the agent */
  response: string;
  /** All messages in the conversation after this turn */
  messages: Message[];
  /** Tool calls executed this turn with their results */
  toolExecutions: Array<{ toolName: string; input: unknown; output: unknown }>;
}

/**
 * Runs one conversational turn of the retention agent.
 *
 * @param userMessage - The participant's message for this turn.
 * @param context - Participant and trial context for this session.
 * @param history - Previous conversation messages (mutated in place).
 * @param llm - LLM client to use for generating responses.
 */
export async function runTurn(
  userMessage: string,
  context: AgentContext,
  history: Message[],
  llm: LlmClient
): Promise<TurnResult> {
  const toolExecutions: TurnResult['toolExecutions'] = [];
  const coordinatorEmail = context.trial.coordinatorEmail;

  if (history.length === 0) {
    history.push({ role: 'system', content: buildSystemPrompt(context) });
  }
  history.push({ role: 'user', content: userMessage });

  /** Executes one tool with guardrails and records it in history. */
  const runTool = (id: string, name: string, rawArgs: string): void => {
    let input: Record<string, unknown> = {};
    let output: unknown;
    try {
      input = rawArgs ? JSON.parse(rawArgs) : {};
      // Privacy guardrail: the agent can only ever act on this participant.
      input.participantId = context.participant.participantId;
      input.visitId = input.visitId || defaultVisitId(context);

      if (name === 'confirmTravel') {
        const blocked = checkBookingApproval(history);
        if (blocked) {
          output = { travelBooked: false, error: blocked };
        } else {
          input.humanConfirmed = true;
        }
      }
      if (output === undefined) output = dispatchTool(name, input);
    } catch (err) {
      output = { error: err instanceof Error ? err.message : String(err) };
    }

    toolExecutions.push({ toolName: name, input, output });
    history.push({
      role: 'tool',
      toolCallId: id,
      toolName: name,
      content: JSON.stringify(output),
    });
  };

  const finish = (text: string): TurnResult => {
    const safe = screenOutput(text, coordinatorEmail);
    history.push({ role: 'assistant', content: safe });
    return { response: safe, messages: history, toolExecutions };
  };

  // ── Input guardrails: handled deterministically, never sent to the model ──
  const screen = screenInput(userMessage);
  if (screen.kind !== 'allow') {
    const urgency = screen.kind === 'emergency' ? 'high' : 'medium';
    const reason =
      screen.kind === 'emergency'
        ? `Possible medical emergency reported by participant: "${userMessage.slice(0, 300)}"`
        : `Participant asked a medical question / reported a possible adverse event: "${userMessage.slice(0, 300)}"`;
    const callId = `guard-${uuidv4().slice(0, 8)}`;
    history.push({
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: callId,
          type: 'function',
          function: {
            name: 'escalateToCoordinator',
            arguments: JSON.stringify({ visitId: defaultVisitId(context), reason, urgency }),
          },
        },
      ],
    });
    runTool(callId, 'escalateToCoordinator', JSON.stringify({ reason, urgency }));
    return finish(
      screen.kind === 'emergency' ? emergencyReply(coordinatorEmail) : medicalReply(coordinatorEmail)
    );
  }

  // ── Agentic loop: call LLM → execute tools → repeat until a text answer ──
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let llmResponse;
    try {
      llmResponse = await llm.chat(history, TOOL_DEFINITIONS);
    } catch (err) {
      console.error('[agent] LLM call failed:', err);
      return finish(
        `Sorry — I'm having trouble connecting right now. Please try again in a moment, ` +
          `or contact your site coordinator at ${coordinatorEmail} if it's urgent.`
      );
    }

    if (llmResponse.toolCalls.length === 0) {
      const text = (llmResponse.content ?? '').trim();
      return finish(
        text || `Sorry, I didn't quite get that. Could you rephrase what you need help with?`
      );
    }

    history.push({
      role: 'assistant',
      content: llmResponse.content ?? '',
      toolCalls: llmResponse.toolCalls,
    });
    for (const tc of llmResponse.toolCalls) {
      runTool(tc.id, tc.function.name, tc.function.arguments);
    }
  }

  console.error(
    `[agent] Max rounds (${MAX_ROUNDS}) exceeded. Tools: ${toolExecutions.map((t) => t.toolName).join(', ')}`
  );
  return finish(
    `Sorry, I wasn't able to finish that request. I've kept your details — could you tell me again ` +
      `what you need, or I can connect you with your coordinator at ${coordinatorEmail}.`
  );
}

// ---------------------------------------------------------------------------
// Session factory
// ---------------------------------------------------------------------------

export interface AgentSession {
  sessionId: string;
  context: AgentContext;
  history: Message[];
  /** Send a message and receive the agent's response. */
  chat(userMessage: string): Promise<TurnResult>;
}

/**
 * Creates a new agent session for a participant.
 *
 * @param context - Participant and trial context.
 * @param llm - LLM client instance.
 */
export function createSession(context: AgentContext, llm: LlmClient): AgentSession {
  const history: Message[] = [];
  const sessionId = uuidv4();
  // Serialize turns so concurrent requests can't interleave history.
  let queue: Promise<unknown> = Promise.resolve();

  return {
    sessionId,
    context,
    history,
    chat: (userMessage: string) => {
      const next = queue.then(() => runTurn(userMessage, context, history, llm));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
