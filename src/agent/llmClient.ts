/**
 * @file agent/llmClient.ts
 * Thin LLM client wrapper that supports both a live IBM watsonx backend
 * and a deterministic mock for local development without credentials.
 *
 * Set MOCK_LLM=true in .env to use the mock.
 * For live calls, set WATSONX_API_KEY, WATSONX_PROJECT_ID, and WATSONX_URL.
 */

import { Message } from '../types';
import { ToolDefinition } from './toolDefinitions';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface LlmResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

/** Common interface for any LLM backend. */
export interface LlmClient {
  chat(messages: Message[], tools: ToolDefinition[]): Promise<LlmResponse>;
}

// ---------------------------------------------------------------------------
// Mock LLM – scripted responses for the scheduling-conflict demo scenario
// ---------------------------------------------------------------------------

/**
 * A scripted mock that drives a deterministic demo of the scheduling-conflict
 * use case without requiring any API credentials.
 * The mock inspects the last user message to decide which step to simulate.
 */
export class MockLlmClient implements LlmClient {
  /** @inheritdoc */
  async chat(messages: Message[], _tools: ToolDefinition[]): Promise<LlmResponse> {
    // Derive context from conversation history rather than a fragile step counter.
    // This ensures correctness regardless of how many internal tool-loop rounds occur.
    const toolsRun = messages
      .filter((m) => m.role === 'tool')
      .map((m) => m.toolName ?? '');

    const hasRun = (name: string) => toolsRun.includes(name);

    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const userText = (lastUser?.content ?? '').toLowerCase();

    // Derive participant / visit from context (system prompt contains participant name).
    // Fall back to P-1042 defaults if not determinable.
    const systemMsg = messages.find((m) => m.role === 'system')?.content ?? '';
    const isJames = systemMsg.includes('James');
    const participantId = isJames ? 'P-1087' : 'P-1042';
    const visitId = isJames ? 'V-1087-03' : 'V-1042-04';
    const visitDate = isJames ? '2024-11-18T14:00:00' : '2024-11-18T09:00:00';
    const firstName = isJames ? 'James' : 'Maria';

    // ── After trackReimbursement ran → confirm submission ─────────────────
    // (checked before the confirmTravel summary so a reimbursement question
    //  that arrives after travel booking gets a proper response)
    if (hasRun('trackReimbursement')) {
      return {
        content:
          `Your reimbursement request has been submitted! You'll receive payment within 5–7 business days. ` +
          `Is there anything else I can help you with, ${firstName}?`,
        toolCalls: [],
        finishReason: 'stop',
      };
    }

    // ── Reimbursement question ─────────────────────────────────────────────
    if (/reimburse|miles|mileage|expense|payment|drive|drove/i.test(userText)) {
      const milesMatch = userText.match(/(\d+)\s*miles?/);
      const miles = milesMatch ? parseInt(milesMatch[1]) : 25;
      return {
        content: `I'll submit a mileage reimbursement request for you now.`,
        toolCalls: [
          {
            id: 'tc-006',
            type: 'function',
            function: {
              name: 'trackReimbursement',
              arguments: JSON.stringify({
                participantId,
                visitId,
                milesDriven: miles,
                hotelNights: 0,
              }),
            },
          },
        ],
        finishReason: 'tool_calls',
      };
    }

    // ── After confirmTravel ran → give full summary ────────────────────────
    if (hasRun('confirmTravel')) {
      return {
        content:
          `All done! Here's a summary:\n` +
          `• Visit rescheduled to November 18th, 2024.\n` +
          `• Travel confirmed to the site.\n` +
          `• Email reminder scheduled for 3 days before your visit.\n\n` +
          `Is there anything else I can help you with, ${firstName}?`,
        toolCalls: [],
        finishReason: 'stop',
      };
    }

    // ── After getTravelOptions ran ─────────────────────────────────────────
    if (hasRun('getTravelOptions') && !hasRun('confirmTravel')) {
      // Check if the agent has already presented the options in a prior assistant turn
      const optionsAlreadyShown = messages.some(
        (m) => m.role === 'assistant' && m.content.includes('travel options for your visit')
      );

      if (optionsAlreadyShown) {
        // User is responding to the options — if approving, book; otherwise re-ask
        const approve = /yes|sure|go ahead|ok|great|please|book|confirm|sounds good/i.test(userText);
        if (approve) {
          const mode = isJames ? 'rideshare' : 'transit';
          return {
            content: "Great, booking your travel now and scheduling a reminder.",
            toolCalls: [
              {
                id: 'tc-004',
                type: 'function',
                function: {
                  name: 'confirmTravel',
                  arguments: JSON.stringify({
                    participantId,
                    visitId,
                    visitDateTime: visitDate,
                    transportMode: mode,
                    requiresHotel: false,
                    humanConfirmed: true,
                  }),
                },
              },
              {
                id: 'tc-005',
                type: 'function',
                function: {
                  name: 'sendReminder',
                  arguments: JSON.stringify({
                    participantId,
                    visitId,
                    channel: 'email',
                    daysBeforeVisit: 3,
                  }),
                },
              },
            ],
            finishReason: 'tool_calls',
          };
        }
        // User didn't confirm — re-present options
        return {
          content: `Just to confirm, would you like me to book the travel option shown above?`,
          toolCalls: [],
          finishReason: 'stop',
        };
      }

      // Options not yet presented — show them now
      const travelCost = isJames ? '$75' : '$5';
      const mode = isJames ? 'rideshare' : 'transit';
      return {
        content:
          `Here are the travel options for your visit:\n` +
          `• ${mode.charAt(0).toUpperCase() + mode.slice(1)} to the site — estimated cost: ${travelCost}.\n\n` +
          `No hotel stay is needed. Would you like me to go ahead and book this?`,
        toolCalls: [],
        finishReason: 'stop',
      };
    }

    // ── After rescheduleVisit ran → ask about travel or fetch options ──────
    if (hasRun('rescheduleVisit') && !hasRun('getTravelOptions')) {
      // If the user said yes / confirmed, fetch travel options now
      const confirmed = /yes|sure|go ahead|ok|great|please|book|travel|option/i.test(userText);
      if (confirmed) {
        return {
          content: "Let me pull up the available travel options and costs for your visit.",
          toolCalls: [
            {
              id: 'tc-003',
              type: 'function',
              function: {
                name: 'getTravelOptions',
                arguments: JSON.stringify({
                  participantId,
                  visitId,
                  visitDateTime: visitDate,
                  requiresHotel: false,
                }),
              },
            },
          ],
          finishReason: 'tool_calls',
        };
      }
      // Otherwise just confirm the reschedule and ask about travel
      return {
        content:
          `Your visit is now rescheduled to November 18th. ` +
          `Would you like me to look up travel options to the site for you?`,
        toolCalls: [],
        finishReason: 'stop',
      };
    }

    // ── After checkVisitWindow ran → reschedule ────────────────────────────
    if (hasRun('checkVisitWindow') && !hasRun('rescheduleVisit')) {
      return {
        content: "November 18th is within the allowed window. I'll go ahead and reschedule your visit now.",
        toolCalls: [
          {
            id: 'tc-002',
            type: 'function',
            function: {
              name: 'rescheduleVisit',
              arguments: JSON.stringify({
                participantId,
                visitId,
                newDateTime: visitDate,
                reason: 'Scheduling conflict on original date',
              }),
            },
          },
        ],
        finishReason: 'tool_calls',
      };
    }

    // ── Conflict / reschedule request → check visit window first ──────────
    if (/conflict|reschedule|move|cancel|change|can't make|cannot make/i.test(userText)) {
      return {
        content: "I'll check whether your proposed date falls within the protocol window.",
        toolCalls: [
          {
            id: 'tc-001',
            type: 'function',
            function: {
              name: 'checkVisitWindow',
              arguments: JSON.stringify({
                participantId,
                visitId,
                proposedDate: '2024-11-18',
              }),
            },
          },
        ],
        finishReason: 'tool_calls',
      };
    }

    // ── Generic fallback ───────────────────────────────────────────────────
    return {
      content:
        `I'm here to help with your clinical trial visit. I can:\n` +
        `• Reschedule your upcoming visit\n` +
        `• Arrange travel and check costs\n` +
        `• Submit reimbursement for mileage or hotel\n` +
        `• Send visit reminders\n\n` +
        `What would you like to do, ${firstName}?`,
      toolCalls: [],
      finishReason: 'stop',
    };
  }
}

// ---------------------------------------------------------------------------
// Watsonx LLM client (live)
// ---------------------------------------------------------------------------

/**
 * Live IBM watsonx AI client using the @ibm-cloud/watsonx-ai SDK.
 * Requires WATSONX_API_KEY, WATSONX_PROJECT_ID, and WATSONX_URL in env.
 */
export class WatsonxLlmClient implements LlmClient {
  private projectId: string;
  private modelId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor() {
    this.projectId = process.env.WATSONX_PROJECT_ID ?? '';
    this.modelId = process.env.WATSONX_MODEL_ID ?? 'ibm/granite-3-8b-instruct';

    // Lazy import so the SDK is only required when MOCK_LLM=false
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WatsonXAI } = require('@ibm-cloud/watsonx-ai');
    this.client = WatsonXAI.newInstance({
      version: '2024-05-31',
      serviceUrl: process.env.WATSONX_URL ?? 'https://us-south.ml.cloud.ibm.com',
    });
  }

  /** @inheritdoc */
  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LlmResponse> {
    const response = await this.client.chat({
      modelId: this.modelId,
      projectId: this.projectId,
      messages: messages.map((m) => ({ role: m.role, content: m.content ?? '' })),
      tools,
      toolChoiceOption: 'auto',
    });

    const choice = response.result?.choices?.[0];
    const msg = choice?.message ?? {};

    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tc: any): ToolCall => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })
    );

    return {
      content: msg.content ?? null,
      toolCalls,
      finishReason:
        choice?.finish_reason === 'tool_calls'
          ? 'tool_calls'
          : choice?.finish_reason === 'stop'
            ? 'stop'
            : 'error',
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns the appropriate LLM client based on the MOCK_LLM env variable.
 * Falls back to MockLlmClient when watsonx credentials are not configured,
 * so the app stays functional in demo / staging environments.
 */
export function createLlmClient(): LlmClient {
  const useMock =
    process.env.MOCK_LLM === 'true' ||
    !process.env.WATSONX_API_KEY ||
    !process.env.WATSONX_PROJECT_ID;

  if (useMock) {
    return new MockLlmClient();
  }
  return new WatsonxLlmClient();
}
