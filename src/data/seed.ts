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
    coordinatorEmail: 'coordinator@meridianbiosciences.com',
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
        scheduledDateTime: '2024-11-15T09:00:00',
        siteLocation: 'NYU Langone Medical Center, 550 1st Ave, New York, NY 10016',
        status: 'scheduled',
        estimatedTravelMinutes: 45,
        window: {
          targetDate: '2024-11-15',
          earliestDate: '2024-11-12',
          latestDate: '2024-11-19',
        },
      },
      {
        visitId: 'V-1042-05',
        visitType: 'treatment',
        scheduledDateTime: '2024-12-13T09:00:00',
        siteLocation: 'NYU Langone Medical Center, 550 1st Ave, New York, NY 10016',
        status: 'scheduled',
        estimatedTravelMinutes: 45,
        window: {
          targetDate: '2024-12-13',
          earliestDate: '2024-12-10',
          latestDate: '2024-12-17',
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
        scheduledDateTime: '2024-11-18T14:00:00',
        siteLocation: 'NYU Langone Medical Center, 550 1st Ave, New York, NY 10016',
        status: 'scheduled',
        estimatedTravelMinutes: 120,
        window: {
          targetDate: '2024-11-18',
          earliestDate: '2024-11-15',
          latestDate: '2024-11-22',
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
