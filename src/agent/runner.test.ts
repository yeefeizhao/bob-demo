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

  it('throws on an unknown tool name', async () => {
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

    await expect(runTurn('do it', context, history, llm)).rejects.toThrow('Unknown tool');
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
