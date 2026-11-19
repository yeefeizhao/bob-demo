/**
 * @file agent/runner.test.ts
 * Unit tests for the agent runner (runTurn / createSession).
 */

import { runTurn, createSession } from './runner';
import { PARTICIPANTS, TRIALS } from '../data/seed';
import { AgentContext, Message } from '../types';
import { LlmClient, LlmResponse } from './llmClient';
import { ToolDefinition } from './toolDefinitions';

// Minimal stub LLM that immediately returns a stop response
function makeStubLlm(response: Partial<LlmResponse>): LlmClient {
  return {
    chat: async (): Promise<LlmResponse> => ({
      content: response.content ?? 'stub response',
      toolCalls: response.toolCalls ?? [],
      finishReason: response.finishReason ?? 'stop',
    }),
  };
}

const context: AgentContext = {
  participant: PARTICIPANTS['P-1042'],
  trial: TRIALS['ONCO-2024-001'],
};

describe('runTurn', () => {
  it('prepends a system message on the first turn', async () => {
    const history: Message[] = [];
    await runTurn('Hello', context, history, makeStubLlm({ content: 'Hi there!' }));

    expect(history[0].role).toBe('system');
    expect(history[0].content).toContain('Clinical Trial Retention Agent');
  });

  it('does not duplicate system message on subsequent turns', async () => {
    const history: Message[] = [];
    await runTurn('Hello', context, history, makeStubLlm({ content: 'Hi' }));
    await runTurn('Hello again', context, history, makeStubLlm({ content: 'Hi again' }));

    const systemMessages = history.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(1);
  });

  it('returns the assistant content as the response', async () => {
    const history: Message[] = [];
    const result = await runTurn(
      'Hello',
      context,
      history,
      makeStubLlm({ content: 'Good morning, Maria!' })
    );

    expect(result.response).toBe('Good morning, Maria!');
  });

  it('executes a tool call and returns the tool execution record', async () => {
    const history: Message[] = [];

    // First call returns a tool call, second returns stop
    let callCount = 0;
    const llm: LlmClient = {
      chat: async (_messages: Message[], _tools: ToolDefinition[]): Promise<LlmResponse> => {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [
              {
                id: 'tc-1',
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
        return { content: 'Window checked!', toolCalls: [], finishReason: 'stop' };
      },
    };

    const result = await runTurn('Can I move my visit?', context, history, llm);

    expect(result.toolExecutions).toHaveLength(1);
    expect(result.toolExecutions[0].toolName).toBe('checkVisitWindow');
    expect(result.response).toBe('Window checked!');
  });

  it('feeds an unknown tool error back to the model instead of crashing', async () => {
    const history: Message[] = [];
    let callCount = 0;
    const llm: LlmClient = {
      chat: async (): Promise<LlmResponse> => {
        callCount++;
        if (callCount === 1) {
          return {
            content: null,
            toolCalls: [
              {
                id: 'tc-bad',
                type: 'function',
                function: { name: 'deleteEverything', arguments: '{}' },
              },
            ],
            finishReason: 'tool_calls',
          };
        }
        return { content: 'done', toolCalls: [], finishReason: 'stop' };
      },
    };

    const result = await runTurn('do it', context, history, llm);
    expect(result.response).toBe('done');
    const toolMsg = history.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('Unknown tool');
  });

  it('returns a friendly message when the LLM call fails', async () => {
    const history: Message[] = [];
    const llm: LlmClient = { chat: async () => { throw new Error('network down'); } };
    const result = await runTurn('Hello', context, history, llm);
    expect(result.response).toContain('trouble connecting');
  });
});

describe('guardrails', () => {
  it('answers medical questions without calling the LLM and notifies the site', async () => {
    const history: Message[] = [];
    const llm: LlmClient = { chat: jest.fn() };
    const result = await runTurn(
      "I've been getting headaches since starting the study drug. Should I skip my next dose?",
      context,
      history,
      llm
    );
    expect(llm.chat).not.toHaveBeenCalled();
    expect(result.response).toContain('not able to give medical advice');
    expect(result.toolExecutions[0].toolName).toBe('escalateToCoordinator');
  });

  it('blocks confirmTravel when the participant has not approved', async () => {
    const history: Message[] = [];
    let n = 0;
    const llm: LlmClient = {
      chat: async (): Promise<LlmResponse> =>
        n++ === 0
          ? {
              content: null,
              toolCalls: [
                {
                  id: 'tc-book',
                  type: 'function',
                  function: {
                    name: 'confirmTravel',
                    arguments: JSON.stringify({
                      visitDateTime: '2024-11-15T09:00:00',
                      transportMode: 'transit',
                      requiresHotel: false,
                      humanConfirmed: true,
                    }),
                  },
                },
              ],
              finishReason: 'tool_calls',
            }
          : { content: 'ok', toolCalls: [], finishReason: 'stop' },
    };
    const result = await runTurn('I need a ride to my visit', context, history, llm);
    expect(result.toolExecutions[0].output).toMatchObject({ travelBooked: false });
  });

  it('forces tool calls onto the session participant', async () => {
    const history: Message[] = [];
    let n = 0;
    const llm: LlmClient = {
      chat: async (): Promise<LlmResponse> =>
        n++ === 0
          ? {
              content: null,
              toolCalls: [
                {
                  id: 'tc-x',
                  type: 'function',
                  function: {
                    name: 'checkVisitWindow',
                    arguments: JSON.stringify({ participantId: 'P-1087', visitId: 'V-1042-04', proposedDate: '2024-11-14' }),
                  },
                },
              ],
              finishReason: 'tool_calls',
            }
          : { content: 'ok', toolCalls: [], finishReason: 'stop' },
    };
    const result = await runTurn('move my visit to nov 14', context, history, llm);
    expect(result.toolExecutions[0].input).toMatchObject({ participantId: 'P-1042' });
  });
});

describe('MockLlmClient conversation (Railway regression)', () => {
  it('does not repeat the booking summary for unrelated follow-ups', async () => {
    const { MockLlmClient } = await import('./llmClient');
    const james: AgentContext = { participant: PARTICIPANTS['P-1087'], trial: TRIALS['ONCO-2024-001'] };
    const session = createSession(james, new MockLlmClient());

    const r1 = await session.chat('I have a conflict and need to reschedule my visit');
    expect(r1.response).toContain('Which date would work');

    const r2 = await session.chat('November 20 works');
    expect(r2.toolExecutions.map((t) => t.toolName)).toEqual(['checkVisitWindow', 'rescheduleVisit']);
    expect(r2.response).toContain('November 20');

    const r3 = await session.chat('yes');
    expect(r3.toolExecutions.map((t) => t.toolName)).toEqual(['getTravelOptions']);

    const r4 = await session.chat('Yes, please book Confirm travel — rideshare');
    expect(r4.toolExecutions.map((t) => t.toolName)).toEqual(['confirmTravel', 'sendReminder']);
    expect(r4.response).toContain('All set');

    const r5 = await session.chat("I've been getting headaches since starting the study drug. Should I skip my next dose?");
    expect(r5.response).toContain('not able to give medical advice');

    const r6 = await session.chat('yes');
    expect(r6.response).not.toContain('All set');
    expect(r6.toolExecutions).toHaveLength(0);
  });
});

describe('createSession', () => {
  it('creates a session with a unique session ID', () => {
    const llm = makeStubLlm({});
    const s1 = createSession(context, llm);
    const s2 = createSession(context, llm);
    expect(s1.sessionId).not.toBe(s2.sessionId);
  });

  it('chat() accumulates history across turns', async () => {
    const llm = makeStubLlm({ content: 'reply' });
    const session = createSession(context, llm);

    await session.chat('first message');
    await session.chat('second message');

    const userMessages = session.history.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(2);
  });
});

describe('OpenAiCompatibleLlmClient', () => {
  it('sends tool history in OpenAI format and parses tool calls', async () => {
    const { OpenAiCompatibleLlmClient } = await import('./llmClient');
    const fetchMock = jest.fn(async (_url: string, _init: { body: string }) => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'sendReminder', arguments: '{"channel":"sms"}' } }],
            },
          },
        ],
      }),
    }));
    const realFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const client = new OpenAiCompatibleLlmClient();
      const res = await client.chat(
        [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: '', toolCalls: [{ id: 't0', type: 'function', function: { name: 'x', arguments: '{}' } }] },
          { role: 'tool', toolCallId: 't0', toolName: 'x', content: '{}' },
        ],
        []
      );
      expect(res.toolCalls[0].function.name).toBe('sendReminder');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('openai/gpt-oss-120b');
      expect(body.messages[2]).toMatchObject({ role: 'assistant', content: null, tool_calls: [{ id: 't0' }] });
      expect(body.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 't0' });
    } finally {
      global.fetch = realFetch;
    }
  });
});
