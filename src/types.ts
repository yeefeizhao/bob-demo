/**
 * @file types.ts
 * Shared domain types for the Clinical Trial Retention Agent.
 */

// ---------------------------------------------------------------------------
// Trial / Participant data model
// ---------------------------------------------------------------------------

export type VisitType = 'screening' | 'baseline' | 'treatment' | 'follow_up' | 'final';
export type VisitStatus = 'scheduled' | 'completed' | 'missed' | 'rescheduled' | 'cancelled';
export type ReimbursementStatus = 'pending' | 'submitted' | 'approved' | 'paid' | 'rejected';

export interface VisitWindow {
  /** Earliest acceptable date for this visit (ISO-8601 date string) */
  earliestDate: string;
  /** Latest acceptable date for this visit (ISO-8601 date string) */
  latestDate: string;
  /** Protocol-mandated ideal date */
  targetDate: string;
}

export interface ScheduledVisit {
  visitId: string;
  visitType: VisitType;
  /** ISO-8601 datetime */
  scheduledDateTime: string;
  siteLocation: string;
  status: VisitStatus;
  window: VisitWindow;
  /** Estimated travel time from participant home in minutes */
  estimatedTravelMinutes: number;
}

export interface Participant {
  participantId: string;
  firstName: string;
  lastName: string;
  contactEmail: string;
  contactPhone: string;
  homeCity: string;
  homeState: string;
  enrolledTrialId: string;
  upcomingVisits: ScheduledVisit[];
}

export interface Trial {
  trialId: string;
  trialName: string;
  phase: 'I' | 'II' | 'III' | 'IV';
  therapeuticArea: string;
  sponsorName: string;
  /** Maximum number of reschedules allowed per visit */
  maxReschedulesPerVisit: number;
  /** Reimbursement rate per mile (USD) */
  mileageRateUsd: number;
  /** Flat hotel rate per night (USD) */
  hotelRateUsd: number;
  coordinatorEmail: string;
}

// ---------------------------------------------------------------------------
// Agent tool inputs / outputs
// ---------------------------------------------------------------------------

export interface CheckVisitWindowInput {
  participantId: string;
  visitId: string;
  proposedDate: string; // ISO-8601 date
}

export interface CheckVisitWindowOutput {
  withinWindow: boolean;
  earliestDate: string;
  latestDate: string;
  targetDate: string;
  reschedulesRemaining: number;
  message: string;
}

export interface RescheduleVisitInput {
  participantId: string;
  visitId: string;
  newDateTime: string; // ISO-8601 datetime
  reason: string;
}

export interface RescheduleVisitOutput {
  success: boolean;
  newVisitDateTime: string;
  confirmationCode: string;
  message: string;
}

export interface GetTravelOptionsInput {
  participantId: string;
  visitId: string;
  visitDateTime: string;
  /** Whether the participant needs hotel accommodation */
  requiresHotel: boolean;
}

export interface TravelOption {
  transportMode: 'rideshare' | 'transit' | 'own_vehicle' | 'flight';
  estimatedTravelCostUsd: number;
  hotelCostUsd: number;
  totalCostUsd: number;
  hotelName?: string;
}

export interface GetTravelOptionsOutput {
  options: TravelOption[];
  message: string;
}

export interface ConfirmTravelInput {
  participantId: string;
  visitId: string;
  visitDateTime: string;
  transportMode: 'rideshare' | 'transit' | 'own_vehicle' | 'flight';
  requiresHotel: boolean;
  /** Must be true — the human operator explicitly approved this booking. */
  humanConfirmed: boolean;
}

export interface ConfirmTravelOutput {
  travelBooked: boolean;
  transportMode: 'rideshare' | 'transit' | 'own_vehicle' | 'flight';
  estimatedCostUsd: number;
  hotelBooked: boolean;
  hotelName?: string;
  confirmationCodes: string[];
  message: string;
}

export interface TrackReimbursementInput {
  participantId: string;
  visitId: string;
  /** Actual miles driven, if applicable */
  milesDriven?: number;
  /** Number of hotel nights, if applicable */
  hotelNights?: number;
}

export interface TrackReimbursementOutput {
  reimbursementId: string;
  status: ReimbursementStatus;
  estimatedAmountUsd: number;
  submittedAt: string;
  message: string;
}

export interface EscalateToCoordinatorInput {
  participantId: string;
  visitId: string;
  reason: string;
  urgency: 'low' | 'medium' | 'high';
}

export interface EscalateToCoordinatorOutput {
  escalationId: string;
  notifiedAt: string;
  coordinatorEmail: string;
  message: string;
}

export interface SendReminderInput {
  participantId: string;
  visitId: string;
  channel: 'email' | 'sms';
  /** Number of days before the visit */
  daysBeforeVisit: number;
}

export interface SendReminderOutput {
  sent: boolean;
  channel: 'email' | 'sms';
  sentAt: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Agent conversation
// ---------------------------------------------------------------------------

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface AgentContext {
  participant: Participant;
  trial: Trial;
  /** Visit the current interaction is centred on */
  activeVisitId?: string;
}
