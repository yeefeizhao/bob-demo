/**
 * @file index.ts
 * Entry point for the Clinical Trial Retention Agent.
 * Exposes the agent session factory and all tool implementations.
 */

export { createSession } from './agent/runner';
export { createLlmClient, MockLlmClient, WatsonxLlmClient, OpenAiCompatibleLlmClient } from './agent/llmClient';
export { TOOL_DEFINITIONS } from './agent/toolDefinitions';
export { buildSystemPrompt } from './agent/systemPrompt';
export {
  checkVisitWindow,
  rescheduleVisit,
  getTravelOptions,
  confirmTravel,
  trackReimbursement,
  escalateToCoordinator,
  sendReminder,
} from './tools';
export * from './types';
