/**
 * @file agent/runner.ts
 * Agent runner: orchestrates the Receive → Plan → Execute → Monitor → Escalate
 * loop described in the pitch deck using an LLM with tool-calling.
 */

import { v4 as uuidv4 } from 'uuid';
import { Message, AgentContext } from '../types';
import { TOOL_DEFINITIONS } from './toolDefinitions';
import { LlmClient } from './llmClient';
import { buildSystemPrompt } from './systemPrompt';
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
const MAX_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatches a tool call by name to its implementation, parsing the
 * JSON arguments string from the LLM into the correct typed input.
 */
function dispatchTool(name: string, argsJson: string): unknown {
  const args = JSON.parse(argsJson);
  switch (name) {
    case 'checkVisitWindow':
      return checkVisitWindow(args);
    case 'rescheduleVisit':
      return rescheduleVisit(args);
    case 'getTravelOptions':
      return getTravelOptions(args);
    case 'confirmTravel':
      return confirmTravel(args);
    case 'trackReimbursement':
      return trackReimbursement(args);
    case 'escalateToCoordinator':
      return escalateToCoordinator(args);
    case 'sendReminder':
      return sendReminder(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
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

  // Build system prompt on the first turn
  if (history.length === 0) {
    const systemContent = buildSystemPrompt(
      `${context.participant.firstName} ${context.participant.lastName}`,
      context.trial.trialName,
      context.trial.coordinatorEmail
    );
    history.push({ role: 'system', content: systemContent });
  }

  // Append user message
  history.push({ role: 'user', content: userMessage });

  // Agentic loop: call LLM → execute tools → repeat until finish
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const llmResponse = await llm.chat(history, TOOL_DEFINITIONS);

    // Append assistant message (content may be null if only tool calls)
    const assistantMsg: Message = {
      role: 'assistant',
      content: llmResponse.content ?? '',
    };
    history.push(assistantMsg);

    // No tool calls → we have the final response
    if (llmResponse.finishReason !== 'tool_calls' || llmResponse.toolCalls.length === 0) {
      return {
        response: llmResponse.content ?? '(no response)',
        messages: history,
        toolExecutions,
      };
    }

    // Execute each tool call and append results
    for (const tc of llmResponse.toolCalls) {
      const toolOutput = dispatchTool(tc.function.name, tc.function.arguments);
      const toolInput = JSON.parse(tc.function.arguments);

      toolExecutions.push({
        toolName: tc.function.name,
        input: toolInput,
        output: toolOutput,
      });

      history.push({
        role: 'tool',
        toolCallId: tc.id,
        toolName: tc.function.name,
        content: JSON.stringify(toolOutput),
      });
    }
  }

  // Safety net: max rounds exceeded
  const errorMsg = `[Agent] Max rounds (${MAX_ROUNDS}) exceeded. Last tool executions: ${toolExecutions.map((t) => t.toolName).join(', ')}.`;
  console.error(errorMsg);
  return { response: errorMsg, messages: history, toolExecutions };
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

  return {
    sessionId,
    context,
    history,
    chat: (userMessage: string) => runTurn(userMessage, context, history, llm),
  };
}
