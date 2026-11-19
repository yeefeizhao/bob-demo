/**
 * @file agent/guardrails.ts
 * Deterministic safety layer that runs around the LLM, independent of which
 * backend (watsonx or mock) is in use. The system prompt asks the model to
 * behave; these checks make sure the critical rules hold even if it doesn't.
 *
 *  - Input screening: emergencies and medical-advice questions get a fixed,
 *    safe reply (and the site team is notified) without reaching the model.
 *  - Booking gate: confirmTravel only runs if the participant explicitly
 *    approved in their latest message, after options were presented.
 *  - Output screening: replies that look like dosing/medication advice are
 *    replaced with a safe redirect.
 */

import { Message } from '../types';

export type InputScreen =
  | { kind: 'allow' }
  | { kind: 'emergency' }
  | { kind: 'medical' };

const EMERGENCY_RE =
  /\b(chest pain|can'?t breathe|cannot breathe|trouble breathing|short(ness)? of breath|passed out|fainted|unconscious|seizure|anaphyla|throat (is )?(closing|swelling)|severe bleeding|coughing (up )?blood|suicid|kill myself|end my life|overdose|stroke|heart attack)\b/i;

const MEDICAL_RE = new RegExp(
  [
    // dosing / medication decisions
    String.raw`\b(dose|doses|dosage|dosing)\b`,
    String.raw`\b(skip|stop|pause|double|halve|miss(ed)?|take)\b.{0,30}\b(medication|medicine|study drug|pills?|tablets?)\b`,
    String.raw`\b(study drug|medication|medicine|immunotherapy|chemo)\b.{0,40}\b(safe|should i|side effect|interact|alcohol|working)\b`,
    // symptoms / side effects
    String.raw`\b(side effects?|symptoms?|headaches?|migraines?|nausea|nauseous|vomit\w*|dizz\w*|fever|rash|itch\w*|fatigue|cough\w*|diarrh\w*|swollen|swelling|bleeding|numb\w*|in pain|hurts?)\b`,
    // clinical questions
    String.raw`\b(diagnos|prognos|scan results?|lab results?|blood (test|work) results?|tumou?r|is it working|placebo|which arm|survival)\b`,
  ].join('|'),
  'i'
);

/**
 * Screens a participant message before it reaches the LLM.
 */
export function screenInput(text: string): InputScreen {
  if (EMERGENCY_RE.test(text)) return { kind: 'emergency' };
  if (MEDICAL_RE.test(text)) return { kind: 'medical' };
  return { kind: 'allow' };
}

export function emergencyReply(coordinatorEmail: string): string {
  return (
    `This sounds like it could be a medical emergency. **Please call 911 or go to the nearest emergency room right now.**\n\n` +
    `I've also alerted your study team (${coordinatorEmail}) as high priority so they can follow up with you. ` +
    `I'm a logistics assistant and can't provide medical help, but I'm here for anything else once you're safe.`
  );
}

export function medicalReply(coordinatorEmail: string): string {
  return (
    `I'm sorry you're dealing with that. I'm not able to give medical advice — including about symptoms, side effects, ` +
    `or whether to take, skip or change any dose of the study drug. Please don't change how you take it without talking to your study doctor first.\n\n` +
    `I've let your site team (${coordinatorEmail}) know so a clinician can follow up with you. ` +
    `If symptoms are severe or getting worse, call 911 or go to the nearest emergency room.\n\n` +
    `Is there anything logistics-related I can help with in the meantime — like rescheduling a visit or arranging travel?`
  );
}

// ---------------------------------------------------------------------------
// Booking gate (human-in-the-loop)
// ---------------------------------------------------------------------------

const APPROVE_RE =
  /\b(yes|yep|yeah|sure|ok(ay)?|please book|book (it|this|that|option)|go ahead|confirm(ed)?|sounds good|do it|approve)\b/i;
const DECLINE_RE = /\b(no|nope|don'?t|do not|not now|cancel|i('| wi)ll (arrange|sort)|myself)\b/i;

/**
 * Returns null if confirmTravel may run, otherwise a reason string that is fed
 * back to the model as the tool result.
 */
export function checkBookingApproval(history: Message[]): string | null {
  const lastUserIdx = findLastIndex(history, (m) => m.role === 'user');
  if (lastUserIdx < 0) return 'No participant message found.';

  const optionsShownEarlier = history
    .slice(0, lastUserIdx)
    .some((m) => m.role === 'tool' && m.toolName === 'getTravelOptions');
  if (!optionsShownEarlier) {
    return 'BLOCKED: call getTravelOptions and present the options to the participant before booking.';
  }

  const text = history[lastUserIdx].content;
  if (DECLINE_RE.test(text) || !APPROVE_RE.test(text)) {
    return 'BLOCKED: the participant has not explicitly approved a travel option in their latest message. Ask them to confirm which option to book.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Output screening
// ---------------------------------------------------------------------------

const UNSAFE_OUTPUT_RE =
  /\b(you (should|can|could|may) (safely )?(skip|stop|pause|double|reduce|increase|take) (your |the |a )?(next )?(dose|medication|study drug|pill|treatment))|\b(take|try) (some )?(ibuprofen|acetaminophen|tylenol|advil|aspirin|paracetamol)\b/i;

/** Replaces model output that looks like medical/dosing advice. */
export function screenOutput(text: string, coordinatorEmail: string): string {
  return UNSAFE_OUTPUT_RE.test(text) ? medicalReply(coordinatorEmail) : text;
}

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}
