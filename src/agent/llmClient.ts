/**
 * @file agent/llmClient.ts
 * Thin LLM client wrapper that supports both a live IBM watsonx backend
 * and a scripted mock for local development without credentials.
 *
 * Live mode: set WATSONX_API_KEY and WATSONX_PROJECT_ID (and optionally
 * WATSONX_URL, WATSONX_MODEL_ID). Set MOCK_LLM=true to force the mock.
 */

import { Message, ToolCall } from '../types';
import { ToolDefinition } from './toolDefinitions';
import { PARTICIPANTS, TRIALS, reimbursements } from '../data/seed';

export type { ToolCall };

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
// Helpers
// ---------------------------------------------------------------------------

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Parses a date like "Nov 20", "November 20th", "11/20", "2024-11-20". Returns YYYY-MM-DD or null. */
export function parseDate(text: string, defaultYear = 2024): string | null {
  const t = text.toLowerCase();
  const pad = (n: number) => String(n).padStart(2, '0');
  let m = t.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : defaultYear;
    return `${y}-${pad(+m[1])}-${pad(+m[2])}`;
  }
  m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m) {
    const month = MONTHS.findIndex((mo) => mo.startsWith(m![1].slice(0, 3))) + 1;
    return `${defaultYear}-${pad(month)}-${pad(+m[2])}`;
  }
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (m) {
    const month = MONTHS.findIndex((mo) => mo.startsWith(m![2])) + 1;
    return `${defaultYear}-${pad(month)}-${pad(+m[1])}`;
  }
  return null;
}

/** "2024-11-18T14:00:00" → "Monday, November 18 at 2:00 PM" */
export function friendlyDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  if (iso.length === 10) return day;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

// ---------------------------------------------------------------------------
// Mock LLM – scripted, conversation-aware responses (no credentials needed)
// ---------------------------------------------------------------------------

const AFFIRM = /\b(yes|yep|yeah|sure|ok(ay)?|please|go ahead|book|confirm|sounds good|do it|that works|correct|right)\b/i;
const DECLINE = /\b(no|nope|not now|don'?t|do not|cancel|myself|never ?mind)\b/i;

/**
 * Scripted mock LLM for demos without watsonx credentials.
 *
 * It looks at (a) tools that ran during the *current* turn, to describe their
 * results, and (b) what the assistant last asked, to interpret short replies
 * like "yes". It never relies on "has this tool ever run", so it doesn't get
 * stuck repeating old summaries. Medical/emergency questions are handled by
 * the runner's guardrails before the mock is called.
 */
export class MockLlmClient implements LlmClient {
  async chat(messages: Message[], _tools: ToolDefinition[]): Promise<LlmResponse> {
    // ── Context ───────────────────────────────────────────────────────────
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const pid = system.match(/participantId: (\S+?)\)/)?.[1] ?? 'P-1042';
    const participant = PARTICIPANTS[pid] ?? Object.values(PARTICIPANTS)[0];
    const trial = TRIALS[participant.enrolledTrialId];
    const visit = participant.upcomingVisits.find((v) => v.status !== 'cancelled') ?? participant.upcomingVisits[0];
    const first = participant.firstName;

    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { lastUserIdx = i; break; }
    const userText = messages[lastUserIdx]?.content ?? '';
    const u = userText.toLowerCase();

    const turn = messages.slice(lastUserIdx + 1);
    const turnTools = turn.filter((m) => m.role === 'tool');
    const lastTool = turnTools[turnTools.length - 1];

    const prevAssistant = [...messages.slice(0, lastUserIdx)]
      .reverse()
      .find((m) => m.role === 'assistant' && m.content.trim() !== '')?.content.toLowerCase() ?? '';

    const say = (content: string): LlmResponse => ({ content, toolCalls: [], finishReason: 'stop' });
    let callN = 0;
    const call = (...calls: Array<[string, Record<string, unknown>]>): LlmResponse => ({
      content: null,
      toolCalls: calls.map(([name, args]) => ({
        id: `mock-${Date.now().toString(36)}-${callN++}`,
        type: 'function',
        function: { name, arguments: JSON.stringify({ participantId: pid, visitId: visit.visitId, ...args }) },
      })),
      finishReason: 'tool_calls',
    });
    const parse = (m?: Message) => { try { return JSON.parse(m?.content ?? '{}'); } catch { return {}; } };
    const argsOf = (name: string): Record<string, unknown> => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const tc = messages[i].toolCalls?.find((c) => c.function.name === name);
        if (tc) { try { return JSON.parse(tc.function.arguments); } catch { return {}; } }
      }
      return {};
    };
    const windowText = `${friendlyDate(visit.window.earliestDate)} and ${friendlyDate(visit.window.latestDate)}`;

    // ── 1. Describe results of tools that ran this turn ──────────────────
    if (lastTool) {
      const out = parse(lastTool);
      if (out.error) {
        if (lastTool.toolName === 'confirmTravel') {
          return say(`Before I book anything, I need your go-ahead. Would you like me to book the travel option above? You can use the **Book this option** button or just reply "yes".`);
        }
        return say(`Sorry, I ran into a problem with that: ${out.error}\n\nWould you like me to pass this to your coordinator?`);
      }
      switch (lastTool.toolName) {
        case 'checkVisitWindow': {
          const proposed = String(argsOf('checkVisitWindow').proposedDate ?? '');
          if (out.withinWindow && out.reschedulesRemaining > 0) {
            const time = visit.scheduledDateTime.slice(10) || 'T09:00:00';
            return call(['rescheduleVisit', { newDateTime: `${proposed}${time}`, reason: 'Participant scheduling conflict' }]);
          }
          if (out.withinWindow) {
            return say(`${friendlyDate(proposed)} is inside your window, but this visit has no reschedules left under the protocol. I can ask your coordinator to review an exception — would you like me to do that?`);
          }
          return say(`Unfortunately ${friendlyDate(proposed)} is outside the protocol window for this visit, which runs between ${windowText}.\n\nWould you like to pick a date in that range, or should I ask your coordinator to review it?`);
        }
        case 'rescheduleVisit':
          return say(
            `Done — your visit is now on **${friendlyDate(out.newVisitDateTime)}** (confirmation code ${out.confirmationCode}).\n\n` +
            `Would you like me to look up travel options to the site for you?`
          );
        case 'getTravelOptions': {
          const lines = (out.options ?? []).map((o: { transportMode: string; estimatedTravelCostUsd: number; hotelCostUsd: number; totalCostUsd: number; hotelName?: string }) =>
            `• **${o.transportMode}** (round trip): $${o.estimatedTravelCostUsd}` +
            (o.hotelCostUsd > 0 ? ` + ${o.hotelName ?? 'hotel'}: $${o.hotelCostUsd}` : '') +
            ` — **total $${o.totalCostUsd}**, covered by the study.`
          );
          return say(`Here's what I found for your visit:\n${lines.join('\n')}\n\nWould you like me to book this? Nothing is booked until you approve.`);
        }
        case 'confirmTravel':
        case 'sendReminder': {
          const travel = turnTools.find((m) => m.toolName === 'confirmTravel');
          const reminder = turnTools.find((m) => m.toolName === 'sendReminder');
          const parts: string[] = [];
          if (travel) {
            const t = parse(travel);
            parts.push(`• Travel booked: ${t.transportMode}, est. $${t.estimatedCostUsd}${t.hotelBooked ? ` (incl. ${t.hotelName})` : ''}. Confirmation: ${(t.confirmationCodes ?? []).join(', ')}`);
          }
          if (reminder) {
            const r = parse(reminder);
            parts.push(`• Reminder set by ${r.channel} ${argsOf('sendReminder').daysBeforeVisit ?? 3} days before your visit.`);
          }
          return say(`All set, ${first}!\n${parts.join('\n')}\n\nAnything else I can help with?`);
        }
        case 'trackReimbursement':
          return say(`Submitted! Your reimbursement **${out.reimbursementId}** for about **$${out.estimatedAmountUsd}** is now ${out.status}. Payments usually arrive within 5–7 business days after sponsor review.`);
        case 'escalateToCoordinator':
          return say(`I've flagged this for your site coordinator (${out.coordinatorEmail ?? trial.coordinatorEmail}), and they'll reach out to you directly. Is there anything you'd like me to add to the note?`);
      }
    }

    // ── 2. Follow-ups to what the assistant just asked ───────────────────
    const affirm = AFFIRM.test(u) && !DECLINE.test(u);
    const decline = DECLINE.test(u) && !AFFIRM.test(u.replace(/no thanks/, ''));

    if (prevAssistant.includes('would you like me to book this')) {
      if (affirm) {
        const opts = argsOf('getTravelOptions');
        const lastOptions = parse([...messages].reverse().find((m) => m.toolName === 'getTravelOptions'));
        const mode = lastOptions.options?.[0]?.transportMode ?? 'rideshare';
        return call(
          ['confirmTravel', { visitDateTime: opts.visitDateTime ?? visit.scheduledDateTime, transportMode: mode, requiresHotel: !!opts.requiresHotel, humanConfirmed: true }],
          ['sendReminder', { channel: 'email', daysBeforeVisit: 3 }]
        );
      }
      if (decline) return say(`No problem — nothing has been booked. Keep your receipts and I can help you submit them for reimbursement afterwards. Anything else?`);
    }
    if (prevAssistant.includes('look up travel options') && affirm) {
      return call(['getTravelOptions', { visitDateTime: visit.scheduledDateTime, requiresHotel: /hotel|overnight|stay/.test(u) }]);
    }
    if (prevAssistant.includes('which date would work') || prevAssistant.includes('pick a date')) {
      const d = parseDate(u);
      if (d) return call(['checkVisitWindow', { proposedDate: d }]);
    }
    if (prevAssistant.includes('should i submit') && affirm) {
      const miles = Number(prevAssistant.match(/(\d+) miles/)?.[1] ?? 0);
      const nights = Number(prevAssistant.match(/(\d+) hotel night/)?.[1] ?? 0);
      return call(['trackReimbursement', { milesDriven: miles, hotelNights: nights }]);
    }
    if ((prevAssistant.includes('ask your coordinator') || prevAssistant.includes('pass this to your coordinator')) && affirm) {
      return call(['escalateToCoordinator', { reason: `Participant request following: "${prevAssistant.slice(0, 160)}"`, urgency: 'medium' }]);
    }
    if (prevAssistant.includes('how many miles')) {
      const miles = u.match(/(\d+)/)?.[1];
      if (miles) return say(`Just to confirm: should I submit a mileage reimbursement for ${miles} miles (about $${(+miles * trial.mileageRateUsd).toFixed(2)}) for your ${visit.visitType} visit?`);
    }

    // ── 3. New intents ───────────────────────────────────────────────────
    if (/\b(speak|talk) (to|with) (a |someone|a person|a human|the coordinator)|\bhuman\b|\bcomplain|\bmistake\b|\bwrong\b|\burgent\b|escalate/.test(u)) {
      return call(['escalateToCoordinator', { reason: userText.slice(0, 300), urgency: /urgent|asap|right now/.test(u) ? 'high' : 'medium' }]);
    }
    if (/reimburs|mileage|\bmiles\b|expense|receipt|paid|payment/.test(u)) {
      if (/status|when|still|waiting|haven'?t|where is|how long/.test(u)) {
        const mine = reimbursements.filter((r) => r.participantId === pid);
        const last = mine[mine.length - 1];
        return say(last
          ? `Your most recent reimbursement (${last.reimbursementId}, $${last.amountUsd}) is **${last.status}**. Payments usually arrive 5–7 business days after sponsor review. If it's been longer than that, I can ask your coordinator to look into it — would you like that?`
          : `I don't see any reimbursement requests on file for you yet. Would you like to submit one? Just tell me how many miles you drove or how many hotel nights you paid for.`);
      }
      const miles = u.match(/(\d+)\s*(mi\b|miles?)/)?.[1];
      const nights = u.match(/(\d+)\s*(hotel )?nights?/)?.[1];
      if (miles || nights) {
        const amt = (+(miles ?? 0)) * trial.mileageRateUsd + (+(nights ?? 0)) * trial.hotelRateUsd;
        return say(`Just to confirm: should I submit a reimbursement for ${miles ? `${miles} miles` : ''}${miles && nights ? ' and ' : ''}${nights ? `${nights} hotel night(s)` : ''} (about $${amt.toFixed(2)})?`);
      }
      return say(`Happy to help with that. How many miles did you drive to and from the site?`);
    }
    if (/reschedul|conflict|can'?t (make|come|go|attend)|cannot (make|come|attend)|won'?t be able|not (be )?available|busy|move (my|the) (visit|appointment)|change (my|the) (visit|appointment|date|time)|different (day|date|time)|another (day|date)|push (it|my visit) back/.test(u)) {
      const d = parseDate(u);
      if (d) return call(['checkVisitWindow', { proposedDate: d }]);
      return say(
        `I can help with that. Your ${visit.visitType} visit is currently on **${friendlyDate(visit.scheduledDateTime)}**. ` +
        `The protocol allows it between ${windowText}.\n\nWhich date would work for you?`
      );
    }
    if (/travel|ride|uber|lyft|taxi|cab|car service|train|bus|hotel|transport|get there|getting there|get to the (site|hospital|clinic)|parking|pick me up|commute/.test(u)) {
      return call(['getTravelOptions', { visitDateTime: visit.scheduledDateTime, requiresHotel: /hotel|overnight|stay|night/.test(u) }]);
    }
    if (/remind|reminder|notif/.test(u)) {
      const days = Number(u.match(/(\d+)\s*days?/)?.[1] ?? 3);
      return call(['sendReminder', { channel: /text|sms/.test(u) ? 'sms' : 'email', daysBeforeVisit: days }]);
    }
    if (/when is|what time|where is|next visit|my visit|appointment/.test(u)) {
      return say(`Your next visit is a ${visit.visitType} visit on **${friendlyDate(visit.scheduledDateTime)}** at ${visit.siteLocation}. Would you like help rescheduling it or arranging travel?`);
    }
    if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(u.trim())) {
      return say(`Hi ${first}! How can I help with your trial visits today?`);
    }
    if (/thank|thanks|thx|appreciate/.test(u)) {
      return say(`You're very welcome, ${first}! Let me know if there's anything else I can do.`);
    }
    if (decline && prevAssistant) {
      return say(`Okay, no problem. Is there anything else I can help with?`);
    }
    if (affirm && /anything (else|logistics)/.test(prevAssistant)) {
      return say(`Sure — what would you like to do? I can reschedule a visit, arrange travel, help with a reimbursement, set a reminder, or connect you with your coordinator.`);
    }
    if (/what can you|help|what do you do|capabilit/.test(u)) {
      return say(
        `Here's what I can help with, ${first}:\n` +
        `• **Reschedule a visit** within the protocol window\n` +
        `• **Arrange travel** (and a hotel if needed), booked only after you approve\n` +
        `• **Reimbursements**: submit mileage/hotel or check status\n` +
        `• **Reminders** by email or text\n` +
        `• **Connect you with your coordinator** for anything else`
      );
    }
    return say(
      `I'm a logistics assistant for your trial, so I can only help with visits, travel, reimbursements, reminders, ` +
      `or connecting you with your coordinator. Could you tell me which of those you need?`
    );
  }
}

// ---------------------------------------------------------------------------
// Watsonx LLM client (live)
// ---------------------------------------------------------------------------

/**
 * Live IBM watsonx.ai client using the @ibm-cloud/watsonx-ai SDK's chat API
 * with native tool calling.
 */
export class WatsonxLlmClient implements LlmClient {
  readonly modelId: string;
  private projectId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor() {
    this.projectId = process.env.WATSONX_PROJECT_ID ?? '';
    this.modelId = process.env.WATSONX_MODEL_ID ?? 'meta-llama/llama-3-3-70b-instruct';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WatsonXAI } = require('@ibm-cloud/watsonx-ai');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { IamAuthenticator } = require('@ibm-cloud/watsonx-ai/authentication');
    this.client = WatsonXAI.newInstance({
      version: '2024-05-31',
      serviceUrl: process.env.WATSONX_URL ?? 'https://us-south.ml.cloud.ibm.com',
      authenticator: new IamAuthenticator({ apikey: process.env.WATSONX_API_KEY ?? '' }),
    });
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LlmResponse> {
    const response = await this.client.textChat({
      modelId: this.modelId,
      projectId: this.projectId,
      messages: toOpenAiMessages(messages),
      tools,
      toolChoiceOption: 'auto',
      maxTokens: 1024,
      temperature: 0.2,
    });
    return fromOpenAiChoice(response.result?.choices?.[0]);
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible client (Groq, Google Gemini, OpenAI, OpenRouter, ...)
// ---------------------------------------------------------------------------

/** Converts internal history to the OpenAI chat-completions message format. */
function toOpenAiMessages(messages: Message[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: tc.function })),
      };
    }
    return { role: m.role, content: m.content ?? '' };
  });
}

/** Normalises one OpenAI-style `choices[0]` into an LlmResponse. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromOpenAiChoice(choice: any): LlmResponse {
  const msg = choice?.message ?? {};
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tc: any, i: number): ToolCall => ({
      id: tc.id || `call-${Date.now().toString(36)}-${i}`,
      type: 'function',
      function: {
        name: tc.function?.name ?? '',
        arguments:
          typeof tc.function?.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments ?? {}),
      },
    })
  );
  return {
    content: msg.content ?? null,
    toolCalls,
    finishReason: toolCalls.length ? 'tool_calls' : choice?.finish_reason === 'length' ? 'length' : 'stop',
  };
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_OPENAI_MODEL = 'openai/gpt-oss-120b';

/**
 * Calls any OpenAI-compatible /chat/completions endpoint with native tool
 * calling. Defaults to Groq's free tier running OpenAI's open-weight
 * gpt-oss-120b. Configure with OPENAI_API_KEY (or GROQ_API_KEY),
 * OPENAI_BASE_URL and OPENAI_MODEL.
 */
export class OpenAiCompatibleLlmClient implements LlmClient {
  readonly model = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  private baseUrl = (process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  private apiKey = process.env.OPENAI_API_KEY ?? process.env.GROQ_API_KEY ?? '';

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LlmResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: toOpenAiMessages(messages),
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM API ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as { choices?: unknown[] };
    return fromOpenAiChoice(data.choices?.[0]);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type LlmMode = 'watsonx' | 'openai' | 'mock';

/**
 * Which backend createLlmClient() will use, based on env:
 * MOCK_LLM=true → mock; watsonx keys → watsonx; OpenAI-compatible key → openai;
 * otherwise mock.
 */
export function llmMode(): LlmMode {
  if (process.env.MOCK_LLM === 'true') return 'mock';
  if (process.env.WATSONX_API_KEY && process.env.WATSONX_PROJECT_ID) return 'watsonx';
  if (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY) return 'openai';
  return 'mock';
}

/** Human-readable model name for the active backend. */
export function llmModelName(): string {
  switch (llmMode()) {
    case 'watsonx':
      return process.env.WATSONX_MODEL_ID ?? 'meta-llama/llama-3-3-70b-instruct';
    case 'openai':
      return process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
    default:
      return 'scripted-mock';
  }
}

/** Returns the client for the configured backend (falls back to the mock). */
export function createLlmClient(): LlmClient {
  switch (llmMode()) {
    case 'watsonx':
      return new WatsonxLlmClient();
    case 'openai':
      return new OpenAiCompatibleLlmClient();
    default:
      return new MockLlmClient();
  }
}
