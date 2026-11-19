/**
 * @file tools/index.ts
 * Agent tool implementations for the Clinical Trial Retention Agent.
 * Each tool corresponds to one discrete action the agent can take.
 * All state mutations operate on in-memory seed data for the prototype.
 */

import { v4 as uuidv4 } from 'uuid';
import { today } from '../data/clock';
import {
  CheckVisitWindowInput,
  CheckVisitWindowOutput,
  RescheduleVisitInput,
  RescheduleVisitOutput,
  GetTravelOptionsInput,
  GetTravelOptionsOutput,
  ConfirmTravelInput,
  ConfirmTravelOutput,
  TrackReimbursementInput,
  TrackReimbursementOutput,
  EscalateToCoordinatorInput,
  EscalateToCoordinatorOutput,
  SendReminderInput,
  SendReminderOutput,
} from '../types';
import {
  PARTICIPANTS,
  TRIALS,
  rescheduleCount,
  reimbursements,
  escalations,
} from '../data/seed';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Parses an ISO-8601 date or datetime string to a plain date string (YYYY-MM-DD).
 */
function toDateString(iso: string): string {
  return iso.substring(0, 10);
}

/**
 * Returns the visit record for a participant, or throws if not found.
 */
function findVisit(participantId: string, visitId: string) {
  const participant = PARTICIPANTS[participantId];
  if (!participant) throw new Error(`Participant ${participantId} not found`);

  const visit = participant.upcomingVisits.find((v) => v.visitId === visitId);
  if (!visit) throw new Error(`Visit ${visitId} not found for participant ${participantId}`);

  const trial = TRIALS[participant.enrolledTrialId];
  if (!trial) throw new Error(`Trial ${participant.enrolledTrialId} not found`);

  return { participant, visit, trial };
}

// ---------------------------------------------------------------------------
// Tool 1 – Check visit window
// ---------------------------------------------------------------------------

/**
 * Checks whether a proposed reschedule date falls within the protocol-allowed
 * visit window and whether the participant has reschedules remaining.
 */
export function checkVisitWindow(input: CheckVisitWindowInput): CheckVisitWindowOutput {
  const { participant, visit, trial } = findVisit(input.participantId, input.visitId);
  const key = `${input.participantId}:${input.visitId}`;
  const used = rescheduleCount[key] ?? 0;
  const remaining = trial.maxReschedulesPerVisit - used;

  const proposed = toDateString(input.proposedDate);
  const inPast = proposed < today();
  const withinWindow =
    !inPast && proposed >= visit.window.earliestDate && proposed <= visit.window.latestDate;

  const message = inPast
    ? `${proposed} has already passed (today is ${today()}). Please choose a future date between ${visit.window.earliestDate} and ${visit.window.latestDate}.`
    : withinWindow
      ? `${proposed} is within the allowed window (${visit.window.earliestDate} – ${visit.window.latestDate}). ${remaining} reschedule(s) remaining for ${participant.firstName}.`
      : `${proposed} is outside the allowed window (${visit.window.earliestDate} – ${visit.window.latestDate}). Coordinator approval may be required.`;

  return {
    withinWindow,
    earliestDate: visit.window.earliestDate,
    latestDate: visit.window.latestDate,
    targetDate: visit.window.targetDate,
    reschedulesRemaining: remaining,
    message,
  };
}

// ---------------------------------------------------------------------------
// Tool 2 – Reschedule visit
// ---------------------------------------------------------------------------

/**
 * Reschedules a visit to a new date/time, updates in-memory state,
 * and returns a confirmation code.
 */
export function rescheduleVisit(input: RescheduleVisitInput): RescheduleVisitOutput {
  const { visit, trial } = findVisit(input.participantId, input.visitId);
  const key = `${input.participantId}:${input.visitId}`;
  const used = rescheduleCount[key] ?? 0;

  if (used >= trial.maxReschedulesPerVisit) {
    return {
      success: false,
      newVisitDateTime: input.newDateTime,
      confirmationCode: '',
      message: `Cannot reschedule: maximum reschedules (${trial.maxReschedulesPerVisit}) already used for visit ${input.visitId}.`,
    };
  }

  // Check proposed date is in the future and within window
  const proposed = toDateString(input.newDateTime);
  if (proposed < today()) {
    return {
      success: false,
      newVisitDateTime: input.newDateTime,
      confirmationCode: '',
      message: `Cannot reschedule: ${proposed} has already passed (today is ${today()}).`,
    };
  }
  if (proposed < visit.window.earliestDate || proposed > visit.window.latestDate) {
    return {
      success: false,
      newVisitDateTime: input.newDateTime,
      confirmationCode: '',
      message: `Cannot reschedule: ${proposed} is outside the protocol window (${visit.window.earliestDate} – ${visit.window.latestDate}). An escalation to the coordinator is recommended.`,
    };
  }

  // Apply change
  visit.scheduledDateTime = input.newDateTime;
  visit.status = 'rescheduled';
  rescheduleCount[key] = used + 1;

  const confirmationCode = `RSC-${uuidv4().substring(0, 8).toUpperCase()}`;
  return {
    success: true,
    newVisitDateTime: input.newDateTime,
    confirmationCode,
    message: `Visit ${input.visitId} successfully rescheduled to ${input.newDateTime}. Confirmation: ${confirmationCode}. Reason logged: "${input.reason}".`,
  };
}

// ---------------------------------------------------------------------------
// Tool 3a – Get travel options (read-only, no booking)
// ---------------------------------------------------------------------------

/** Shared cost calculation helper reused by both travel tools. */
function computeTravelCosts(
  estimatedTravelMinutes: number,
  hotelRateUsd: number,
  requiresHotel: boolean
) {
  const mode =
    estimatedTravelMinutes > 180
      ? ('flight' as const)
      : estimatedTravelMinutes > 60
        ? ('rideshare' as const)
        : ('transit' as const);

  const distanceMiles = Math.round((estimatedTravelMinutes / 60) * 30); // rough 30 mph avg
  const travelCostUsd =
    mode === 'flight' ? 250 : mode === 'rideshare' ? Math.round(distanceMiles * 2.5) : 5;
  const hotelCostUsd = requiresHotel ? hotelRateUsd : 0;

  return { mode, travelCostUsd, hotelCostUsd };
}

/**
 * Returns available travel options with cost estimates for a participant's visit.
 * Does NOT book anything — present these options to the human before confirming.
 */
export function getTravelOptions(input: GetTravelOptionsInput): GetTravelOptionsOutput {
  const { participant, visit, trial } = findVisit(input.participantId, input.visitId);
  const { mode, travelCostUsd, hotelCostUsd } = computeTravelCosts(
    visit.estimatedTravelMinutes,
    trial.hotelRateUsd,
    input.requiresHotel
  );

  const hotelName = input.requiresHotel ? 'Holiday Inn Express Midtown Manhattan' : undefined;
  const totalCostUsd = travelCostUsd + hotelCostUsd;

  const option = {
    transportMode: mode,
    estimatedTravelCostUsd: travelCostUsd,
    hotelCostUsd,
    totalCostUsd,
    ...(hotelName ? { hotelName } : {}),
  };

  return {
    options: [option],
    message:
      `Travel options for ${participant.firstName} ${participant.lastName} to ${visit.siteLocation} ` +
      `on ${toDateString(input.visitDateTime)}: ` +
      `${mode} ($${travelCostUsd})` +
      (input.requiresHotel ? `, hotel "${hotelName}" ($${hotelCostUsd}/night)` : '') +
      `. Total estimated cost: $${totalCostUsd}. ` +
      `Please present these options to the participant and await their confirmation before booking.`,
  };
}

// ---------------------------------------------------------------------------
// Tool 3b – Confirm travel (books after human approval)
// ---------------------------------------------------------------------------

/**
 * Books the selected travel option after explicit human confirmation.
 * Requires humanConfirmed=true; returns an error if confirmation is missing.
 */
export function confirmTravel(input: ConfirmTravelInput): ConfirmTravelOutput {
  if (!input.humanConfirmed) {
    return {
      travelBooked: false,
      transportMode: input.transportMode,
      estimatedCostUsd: 0,
      hotelBooked: false,
      confirmationCodes: [],
      message: 'Travel booking requires explicit human confirmation. Set humanConfirmed=true only after the participant has agreed to the presented options.',
    };
  }

  const { participant, visit, trial } = findVisit(input.participantId, input.visitId);
  const { travelCostUsd, hotelCostUsd } = computeTravelCosts(
    visit.estimatedTravelMinutes,
    trial.hotelRateUsd,
    input.requiresHotel
  );
  const totalCostUsd = travelCostUsd + hotelCostUsd;

  const travelCode = `TRV-${uuidv4().substring(0, 8).toUpperCase()}`;
  const hotelCode = input.requiresHotel ? `HTL-${uuidv4().substring(0, 8).toUpperCase()}` : null;
  const confirmationCodes = [travelCode, ...(hotelCode ? [hotelCode] : [])];
  const hotelName = input.requiresHotel ? 'Holiday Inn Express Midtown Manhattan' : undefined;

  return {
    travelBooked: true,
    transportMode: input.transportMode,
    estimatedCostUsd: totalCostUsd,
    hotelBooked: input.requiresHotel,
    hotelName,
    confirmationCodes,
    message:
      `Travel confirmed for ${participant.firstName} ${participant.lastName}: ` +
      `${input.transportMode} to ${visit.siteLocation} on ${toDateString(input.visitDateTime)}. ` +
      `Estimated cost: $${totalCostUsd}. Codes: ${confirmationCodes.join(', ')}.`,
  };
}

// ---------------------------------------------------------------------------
// Tool 4 – Track reimbursement
// ---------------------------------------------------------------------------

/**
 * Submits a reimbursement request for a completed or rescheduled visit
 * and records it in the in-memory ledger.
 */
export function trackReimbursement(input: TrackReimbursementInput): TrackReimbursementOutput {
  const { trial } = findVisit(input.participantId, input.visitId);

  const mileage = (input.milesDriven ?? 0) * trial.mileageRateUsd;
  const hotel = (input.hotelNights ?? 0) * trial.hotelRateUsd;
  const total = Math.round((mileage + hotel) * 100) / 100;

  const reimbursementId = `RMB-${uuidv4().substring(0, 8).toUpperCase()}`;
  const submittedAt = new Date().toISOString();

  reimbursements.push({
    reimbursementId,
    participantId: input.participantId,
    visitId: input.visitId,
    status: 'submitted',
    amountUsd: total,
    submittedAt,
  });

  return {
    reimbursementId,
    status: 'submitted',
    estimatedAmountUsd: total,
    submittedAt,
    message: `Reimbursement ${reimbursementId} submitted for $${total.toFixed(2)} (${input.milesDriven ?? 0} miles @ $${trial.mileageRateUsd}/mi, ${input.hotelNights ?? 0} hotel night(s) @ $${trial.hotelRateUsd}/night).`,
  };
}

// ---------------------------------------------------------------------------
// Tool 5 – Escalate to coordinator
// ---------------------------------------------------------------------------

/**
 * Escalates a situation to the site coordinator when the agent cannot
 * resolve it autonomously (e.g., out-of-window reschedule request).
 */
export function escalateToCoordinator(
  input: EscalateToCoordinatorInput
): EscalateToCoordinatorOutput {
  const { trial } = findVisit(input.participantId, input.visitId);

  const escalationId = `ESC-${uuidv4().substring(0, 8).toUpperCase()}`;
  const notifiedAt = new Date().toISOString();

  escalations.push({
    escalationId,
    participantId: input.participantId,
    visitId: input.visitId,
    reason: input.reason,
    urgency: input.urgency,
    notifiedAt,
  });

  return {
    escalationId,
    notifiedAt,
    coordinatorEmail: trial.coordinatorEmail,
    message: `Escalation ${escalationId} raised (urgency: ${input.urgency}) and sent to ${trial.coordinatorEmail}. Reason: "${input.reason}".`,
  };
}

// ---------------------------------------------------------------------------
// Tool 6 – Send reminder
// ---------------------------------------------------------------------------

/**
 * Sends a visit reminder to the participant via email or SMS.
 */
export function sendReminder(input: SendReminderInput): SendReminderOutput {
  const { participant, visit } = findVisit(input.participantId, input.visitId);

  const address =
    input.channel === 'email' ? participant.contactEmail : participant.contactPhone;

  const sentAt = new Date().toISOString();

  // In the prototype, just simulate sending
  console.log(
    `[Reminder] Sending ${input.channel} to ${address}: Visit ${visit.visitId} in ${input.daysBeforeVisit} day(s) at ${visit.scheduledDateTime}.`
  );

  return {
    sent: true,
    channel: input.channel,
    sentAt,
    message: `${input.channel.toUpperCase()} reminder sent to ${address} (${input.daysBeforeVisit} day(s) before visit ${visit.visitId}).`,
  };
}
