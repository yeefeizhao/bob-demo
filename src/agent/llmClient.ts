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
  private step = 0;

  /** @inheritdoc */
  async chat(messages: Message[], _tools: ToolDefinition[]): Promise<LlmResponse> {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const content = lastUser?.content ?? '';

    // Step 0 – participant reports a conflict → check visit window
    if (this.step === 0 && content.toLowerCase().includes('conflict')) {
      this.step = 1;
      return {
        content: "I'll check whether your proposed date falls within the protocol window.",
        toolCalls: [
          {
            id: 'tc-001',
            type: 'function',
            function: {
              name: 'checkVisitWindow',
              arguments: JSON.stringify({
                participantId: 'P-1042',
                visitId: 'V-1042-04',
                proposedDate: '2024-11-18',
              }),
            },
          },
        ],
        finishReason: 'tool_calls',
      };
    }

    // Step 1 – after checkVisitWindow → reschedule
    if (this.step === 1) {
      this.step = 2;
      return {
        content:
          "November 18th is within the allowed window and you have reschedules remaining. I'll go ahead and reschedule your visit now.",
        toolCalls: [
          {
            id: 'tc-002',
            type: 'function',
            function: {
              name: 'rescheduleVisit',
              arguments: JSON.stringify({
                participantId: 'P-1042',
                visitId: 'V-1042-04',
                newDateTime: '2024-11-18T09:00:00',
                reason: 'Work conflict on original date',
              }),
            },
          },
        ],
        finishReason: 'tool_calls',
      };
    }

    // Step 2 – after rescheduleVisit → summarise and ask about travel
    if (this.step === 2) {
      this.step = 3;
      return {
        content:
          "Your visit is now rescheduled to November 18th at 9:00 AM. " +
          "Would you like me to look up travel options to the site for you?",
        toolCalls: [],
        finishReason: 'stop',
      };
    }

    // Step 3 – participant confirms date and mentions driving → fetch travel options
    if (this.step === 3) {
      this.step = 4;
      return {
        content: "Let me pull up the available travel options and costs for your visit.",
        toolCalls: [
          {
            id: 'tc-003',
            type: 'function',
            function: {
              name: 'getTravelOptions',
              arguments: JSON.stringify({
                participantId: 'P-1042',
                visitId: 'V-1042-04',
                visitDateTime: '2024-11-18T09:00:00',
                requiresHotel: false,
              }),
            },
          },
        ],
        finishReason: 'tool_calls',
      };
    }

    // Step 4 – after getTravelOptions → present options, await human approval
    if (this.step === 4) {
      this.step = 5;
      return {
        content:
          "Here are your travel options for November 18th:\n" +
          "• Transit to NYU Langone Medical Center — estimated cost: $5.\n\n" +
          "No hotel is needed. Would you like me to go ahead and book this?",
        toolCalls: [],
        finishReason: 'stop',
      };
    }

    // Step 5 – participant approves → confirm travel booking + send reminder
    if (this.step === 5) {
      this.step = 6;
      return {
        content: "Great, booking your travel now and scheduling a reminder.",
        toolCalls: [
          {
            id: 'tc-004',
            type: 'function',
            function: {
              name: 'confirmTravel',
              arguments: JSON.stringify({
                participantId: 'P-1042',
                visitId: 'V-1042-04',
                visitDateTime: '2024-11-18T09:00:00',
                transportMode: 'transit',
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
                participantId: 'P-1042',
                visitId: 'V-1042-04',
                channel: 'email',
                daysBeforeVisit: 3,
              }),
            },
          },
        ],
        finishReason: 'tool_calls',
      };
    }

    // Step 6 – after confirmTravel + sendReminder → full summary
    if (this.step === 6) {
      this.step = 7;
      return {
        content:
          'All done! Here is a summary:\n' +
          '• Visit rescheduled to November 18th, 2024 at 9:00 AM.\n' +
          '• Travel booked to NYU Langone Medical Center (transit, $5).\n' +
          '• Email reminder will be sent 3 days before your visit.\n\n' +
          'If anything else comes up, just let me know. Take care, Maria!',
        toolCalls: [],
        finishReason: 'stop',
      };
    }

    // Step 7 – reimbursement question
    this.step = 0;
    return {
      content:
        'All done! Here is a summary:\n' +
        '• Visit rescheduled to November 18th, 2024 at 9:00 AM.\n' +
        '• Travel booked to NYU Langone Medical Center (transit, $5).\n' +
        '• Email reminder will be sent 3 days before your visit.\n\n' +
        'If anything else comes up, just let me know. Take care, Maria!',
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
