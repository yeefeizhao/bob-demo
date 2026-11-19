/**
 * @file data/seed.ts
 * In-memory seed data simulating a trial database.
 * Replaces real CTMS / EDC integrations for the prototype.
 */

import { Participant, Trial } from '../types';

/** Sample oncology trial (Phase II) */
export const TRIALS: Record<string, Trial> = {
  'ONCO-2024-001': {
    trialId: 'ONCO-2024-001',
    trialName: 'LUMINA-2: Adjuvant Immunotherapy in Stage III NSCLC',
    phase: 'II',
    therapeuticArea: 'Oncology',
    sponsorName: 'Meridian Biosciences',
    maxReschedulesPerVisit: 2,
    mileageRateUsd: 0.67,
    hotelRateUsd: 150,
    coordinatorEmail: 'support@email.com',
  },
};

/** Sample participants enrolled in ONCO-2024-001 */
export const PARTICIPANTS: Record<string, Participant> = {
  'P-1042': {
    participantId: 'P-1042',
    firstName: 'Maria',
    lastName: 'Santos',
    contactEmail: 'maria.santos@example.com',
    contactPhone: '+1-555-0142',
    homeCity: 'Brooklyn',
    homeState: 'NY',
    enrolledTrialId: 'ONCO-2024-001',
    upcomingVisits: [
      {
        visitId: 'V-1042-04',
        visitType: 'treatment',
        scheduledDateTime: '2026-11-20T09:00:00',
        siteLocation: 'NYU Langone Medical Center, 550 1st Ave, New York, NY 10016',
        status: 'scheduled',
        estimatedTravelMinutes: 45,
        window: {
          targetDate: '2026-11-20',
          earliestDate: '2026-11-17',
          latestDate: '2026-11-24',
        },
      },
      {
        visitId: 'V-1042-05',
        visitType: 'treatment',
        scheduledDateTime: '2026-12-18T09:00:00',
        siteLocation: 'NYU Langone Medical Center, 550 1st Ave, New York, NY 10016',
        status: 'scheduled',
        estimatedTravelMinutes: 45,
        window: {
          targetDate: '2026-12-18',
          earliestDate: '2026-12-15',
          latestDate: '2026-12-22',
        },
      },
    ],
  },
  'P-1087': {
    participantId: 'P-1087',
    firstName: 'James',
    lastName: 'Okafor',
    contactEmail: 'james.okafor@example.com',
    contactPhone: '+1-555-0187',
    homeCity: 'Philadelphia',
    homeState: 'PA',
    enrolledTrialId: 'ONCO-2024-001',
    upcomingVisits: [
      {
        visitId: 'V-1087-03',
        visitType: 'treatment',
        scheduledDateTime: '2026-11-23T14:00:00',
        siteLocation: 'NYU Langone Medical Center, 550 1st Ave, New York, NY 10016',
        status: 'scheduled',
        estimatedTravelMinutes: 120,
        window: {
          targetDate: '2026-11-23',
          earliestDate: '2026-11-20',
          latestDate: '2026-11-27',
        },
      },
    ],
  },
};

/**
 * Tracks how many times each visit has been rescheduled.
 * Key: `${participantId}:${visitId}`
 */
export const rescheduleCount: Record<string, number> = {};

/** Simple in-memory reimbursement ledger. */
export const reimbursements: Array<{
  reimbursementId: string;
  participantId: string;
  visitId: string;
  status: string;
  amountUsd: number;
  submittedAt: string;
}> = [];

/** Simple escalation log. */
export const escalations: Array<{
  escalationId: string;
  participantId: string;
  visitId: string;
  reason: string;
  urgency: string;
  notifiedAt: string;
}> = [];
