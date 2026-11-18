/**
 * @file tools/index.test.ts
 * Unit tests for all agent tool implementations.
 */

import {
  checkVisitWindow,
  rescheduleVisit,
  getTravelOptions,
  confirmTravel,
  trackReimbursement,
  escalateToCoordinator,
  sendReminder,
} from './index';
import { rescheduleCount, reimbursements, escalations, PARTICIPANTS } from '../data/seed';

// Reset mutable state before each test so tests are isolated
beforeEach(() => {
  // Reset reschedule counts
  Object.keys(rescheduleCount).forEach((k) => delete rescheduleCount[k]);

  // Reset reimbursements and escalations arrays
  reimbursements.splice(0);
  escalations.splice(0);

  // Reset visit statuses and datetimes for P-1042 V-1042-04
  const p = PARTICIPANTS['P-1042'];
  const v = p.upcomingVisits.find((v) => v.visitId === 'V-1042-04');
  if (v) {
    v.scheduledDateTime = '2024-11-15T09:00:00';
    v.status = 'scheduled';
  }
});

// ---------------------------------------------------------------------------
// checkVisitWindow
// ---------------------------------------------------------------------------

describe('checkVisitWindow', () => {
  it('returns withinWindow=true when proposed date is inside the window', () => {
    const result = checkVisitWindow({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      proposedDate: '2024-11-18',
    });

    expect(result.withinWindow).toBe(true);
    expect(result.reschedulesRemaining).toBe(2);
    expect(result.message).toContain('within the allowed window');
  });

  it('returns withinWindow=false when proposed date is before the window', () => {
    const result = checkVisitWindow({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      proposedDate: '2024-11-10',
    });

    expect(result.withinWindow).toBe(false);
    expect(result.message).toContain('outside the allowed window');
  });

  it('returns withinWindow=false when proposed date is after the window', () => {
    const result = checkVisitWindow({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      proposedDate: '2024-11-25',
    });

    expect(result.withinWindow).toBe(false);
  });

  it('throws an error for an unknown participant', () => {
    expect(() =>
      checkVisitWindow({ participantId: 'P-XXXX', visitId: 'V-0000-00', proposedDate: '2024-11-18' })
    ).toThrow('Participant P-XXXX not found');
  });

  it('reflects remaining reschedules after one has been used', () => {
    rescheduleCount['P-1042:V-1042-04'] = 1;
    const result = checkVisitWindow({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      proposedDate: '2024-11-18',
    });
    expect(result.reschedulesRemaining).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// rescheduleVisit
// ---------------------------------------------------------------------------

describe('rescheduleVisit', () => {
  it('reschedules successfully when date is within window', () => {
    const result = rescheduleVisit({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      newDateTime: '2024-11-18T09:00:00',
      reason: 'Work conflict',
    });

    expect(result.success).toBe(true);
    expect(result.newVisitDateTime).toBe('2024-11-18T09:00:00');
    expect(result.confirmationCode).toMatch(/^RSC-/);
    expect(rescheduleCount['P-1042:V-1042-04']).toBe(1);
  });

  it('fails when max reschedules already used', () => {
    rescheduleCount['P-1042:V-1042-04'] = 2;
    const result = rescheduleVisit({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      newDateTime: '2024-11-18T09:00:00',
      reason: 'Work conflict',
    });

    expect(result.success).toBe(false);
    expect(result.confirmationCode).toBe('');
    expect(result.message).toContain('maximum reschedules');
  });

  it('fails when proposed date is outside the protocol window', () => {
    const result = rescheduleVisit({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      newDateTime: '2024-11-25T09:00:00',
      reason: 'Vacation',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('outside the protocol window');
  });

  it('updates the visit record in seed data on success', () => {
    rescheduleVisit({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      newDateTime: '2024-11-18T09:00:00',
      reason: 'Work conflict',
    });

    const visit = PARTICIPANTS['P-1042'].upcomingVisits.find((v) => v.visitId === 'V-1042-04');
    expect(visit?.status).toBe('rescheduled');
    expect(visit?.scheduledDateTime).toBe('2024-11-18T09:00:00');
  });
});

// ---------------------------------------------------------------------------
// getTravelOptions
// ---------------------------------------------------------------------------

describe('getTravelOptions', () => {
  it('returns transit option for short-distance participant (< 60 min travel)', () => {
    const result = getTravelOptions({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      visitDateTime: '2024-11-18T09:00:00',
      requiresHotel: false,
    });

    // P-1042 has 45 min estimated travel → transit
    expect(result.options).toHaveLength(1);
    expect(result.options[0].transportMode).toBe('transit');
    expect(result.options[0].hotelCostUsd).toBe(0);
    expect(result.options[0].totalCostUsd).toBe(result.options[0].estimatedTravelCostUsd);
    expect(result.message).toContain('present these options');
  });

  it('returns rideshare option for medium-distance participant (> 60 min travel)', () => {
    const result = getTravelOptions({
      participantId: 'P-1087',
      visitId: 'V-1087-03',
      visitDateTime: '2024-11-18T14:00:00',
      requiresHotel: false,
    });

    // P-1087 has 120 min estimated travel → rideshare
    expect(result.options[0].transportMode).toBe('rideshare');
  });

  it('includes hotel cost breakdown when hotel is required', () => {
    const result = getTravelOptions({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      visitDateTime: '2024-11-18T09:00:00',
      requiresHotel: true,
    });

    expect(result.options[0].hotelCostUsd).toBeGreaterThan(0);
    expect(result.options[0].hotelName).toBeDefined();
    expect(result.options[0].totalCostUsd).toBe(
      result.options[0].estimatedTravelCostUsd + result.options[0].hotelCostUsd
    );
    // No booking codes — read-only
    expect(result.message).toContain('present these options');
  });

  it('does not book anything (no confirmation codes in output)', () => {
    const result = getTravelOptions({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      visitDateTime: '2024-11-18T09:00:00',
      requiresHotel: false,
    });

    // Output has no confirmation codes — this is a read-only estimation
    expect((result as unknown as Record<string, unknown>).confirmationCodes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// confirmTravel
// ---------------------------------------------------------------------------

describe('confirmTravel', () => {
  it('books travel and returns confirmation codes when humanConfirmed=true', () => {
    const result = confirmTravel({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      visitDateTime: '2024-11-18T09:00:00',
      transportMode: 'transit',
      requiresHotel: false,
      humanConfirmed: true,
    });

    expect(result.travelBooked).toBe(true);
    expect(result.transportMode).toBe('transit');
    expect(result.hotelBooked).toBe(false);
    expect(result.confirmationCodes.length).toBeGreaterThanOrEqual(1);
    expect(result.confirmationCodes[0]).toMatch(/^TRV-/);
  });

  it('refuses to book when humanConfirmed=false', () => {
    const result = confirmTravel({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      visitDateTime: '2024-11-18T09:00:00',
      transportMode: 'transit',
      requiresHotel: false,
      humanConfirmed: false,
    });

    expect(result.travelBooked).toBe(false);
    expect(result.confirmationCodes).toHaveLength(0);
    expect(result.message).toContain('human confirmation');
  });

  it('includes hotel confirmation code when hotel is required and humanConfirmed=true', () => {
    const result = confirmTravel({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      visitDateTime: '2024-11-18T09:00:00',
      transportMode: 'transit',
      requiresHotel: true,
      humanConfirmed: true,
    });

    expect(result.hotelBooked).toBe(true);
    expect(result.hotelName).toBeDefined();
    expect(result.confirmationCodes.length).toBe(2);
    expect(result.confirmationCodes[1]).toMatch(/^HTL-/);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// trackReimbursement
// ---------------------------------------------------------------------------

describe('trackReimbursement', () => {
  it('submits a reimbursement and records it in the ledger', () => {
    const result = trackReimbursement({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      milesDriven: 25,
      hotelNights: 0,
    });

    expect(result.status).toBe('submitted');
    expect(result.reimbursementId).toMatch(/^RMB-/);
    // 25 miles × $0.67 = $16.75
    expect(result.estimatedAmountUsd).toBeCloseTo(16.75, 2);
    expect(reimbursements).toHaveLength(1);
  });

  it('calculates combined mileage and hotel reimbursement correctly', () => {
    const result = trackReimbursement({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      milesDriven: 50,
      hotelNights: 1,
    });

    // 50 × 0.67 + 1 × 150 = 33.5 + 150 = 183.5
    expect(result.estimatedAmountUsd).toBeCloseTo(183.5, 2);
  });

  it('handles missing optional fields (zero miles and nights)', () => {
    const result = trackReimbursement({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
    });

    expect(result.estimatedAmountUsd).toBe(0);
    expect(result.status).toBe('submitted');
  });
});

// ---------------------------------------------------------------------------
// escalateToCoordinator
// ---------------------------------------------------------------------------

describe('escalateToCoordinator', () => {
  it('creates an escalation record and returns coordinator email', () => {
    const result = escalateToCoordinator({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      reason: 'Participant requests reschedule outside protocol window',
      urgency: 'high',
    });

    expect(result.escalationId).toMatch(/^ESC-/);
    expect(result.coordinatorEmail).toBe('coordinator@meridianbiosciences.com');
    expect(escalations).toHaveLength(1);
    expect(escalations[0].urgency).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// sendReminder
// ---------------------------------------------------------------------------

describe('sendReminder', () => {
  it('sends an email reminder and returns sent=true', () => {
    const result = sendReminder({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      channel: 'email',
      daysBeforeVisit: 3,
    });

    expect(result.sent).toBe(true);
    expect(result.channel).toBe('email');
    expect(result.message).toContain('EMAIL');
  });

  it('sends an SMS reminder and returns sent=true', () => {
    const result = sendReminder({
      participantId: 'P-1042',
      visitId: 'V-1042-04',
      channel: 'sms',
      daysBeforeVisit: 1,
    });

    expect(result.sent).toBe(true);
    expect(result.channel).toBe('sms');
    expect(result.message).toContain('SMS');
  });
});
