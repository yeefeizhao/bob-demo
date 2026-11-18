/**
 * @file agent/toolDefinitions.ts
 * JSON Schema tool definitions passed to the LLM so it knows which tools
 * are available and what parameters to supply. Compatible with
 * OpenAI function-calling and IBM watsonx tool_choice format.
 */

/** A single tool definition in OpenAI / watsonx tool-call format. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** All tools exposed to the retention agent. */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'checkVisitWindow',
      description:
        'Checks whether a proposed reschedule date falls within the protocol-allowed visit window and how many reschedules remain. Always call this before rescheduling.',
      parameters: {
        type: 'object',
        properties: {
          participantId: { type: 'string', description: 'Participant identifier' },
          visitId: { type: 'string', description: 'Visit identifier to check' },
          proposedDate: {
            type: 'string',
            description: 'Proposed new date in ISO-8601 format (YYYY-MM-DD)',
          },
        },
        required: ['participantId', 'visitId', 'proposedDate'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rescheduleVisit',
      description:
        'Reschedules a visit to a new date and time. Only call after checkVisitWindow confirms the date is valid.',
      parameters: {
        type: 'object',
        properties: {
          participantId: { type: 'string' },
          visitId: { type: 'string' },
          newDateTime: {
            type: 'string',
            description: 'New visit date and time in ISO-8601 format (YYYY-MM-DDTHH:MM:SS)',
          },
          reason: {
            type: 'string',
            description: 'Brief reason for the reschedule as stated by the participant',
          },
        },
        required: ['participantId', 'visitId', 'newDateTime', 'reason'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getTravelOptions',
      description:
        'Returns available travel options and cost estimates for a participant\'s visit. ' +
        'Always call this first and present the options to the participant before booking. ' +
        'Never call confirmTravel without first showing these options and receiving human approval.',
      parameters: {
        type: 'object',
        properties: {
          participantId: { type: 'string' },
          visitId: { type: 'string' },
          visitDateTime: {
            type: 'string',
            description: 'Confirmed visit date and time in ISO-8601 format',
          },
          requiresHotel: {
            type: 'boolean',
            description: 'Whether the participant needs a hotel night',
          },
        },
        required: ['participantId', 'visitId', 'visitDateTime', 'requiresHotel'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirmTravel',
      description:
        'Books the selected travel option ONLY after the human participant has explicitly approved ' +
        'the options returned by getTravelOptions. Set humanConfirmed=true only when the participant ' +
        'has confirmed in this conversation. Never set humanConfirmed=true autonomously.',
      parameters: {
        type: 'object',
        properties: {
          participantId: { type: 'string' },
          visitId: { type: 'string' },
          visitDateTime: {
            type: 'string',
            description: 'Confirmed visit date and time in ISO-8601 format',
          },
          transportMode: {
            type: 'string',
            enum: ['rideshare', 'transit', 'own_vehicle', 'flight'],
            description: 'The transport mode the participant selected from the presented options',
          },
          requiresHotel: {
            type: 'boolean',
            description: 'Whether the participant confirmed they need a hotel night',
          },
          humanConfirmed: {
            type: 'boolean',
            description:
              'Must be true. Only set this to true when the participant has explicitly said yes ' +
              'to the travel options presented in this conversation.',
          },
        },
        required: [
          'participantId',
          'visitId',
          'visitDateTime',
          'transportMode',
          'requiresHotel',
          'humanConfirmed',
        ],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trackReimbursement',
      description:
        'Submits a reimbursement request for mileage and/or hotel costs after a visit.',
      parameters: {
        type: 'object',
        properties: {
          participantId: { type: 'string' },
          visitId: { type: 'string' },
          milesDriven: {
            type: 'number',
            description: 'Miles driven by the participant (if driving own vehicle)',
          },
          hotelNights: {
            type: 'number',
            description: 'Number of hotel nights to reimburse',
          },
        },
        required: ['participantId', 'visitId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escalateToCoordinator',
      description:
        'Escalates an issue to the site coordinator when the agent cannot resolve it autonomously. Use for out-of-window requests, payment disputes, or safety concerns.',
      parameters: {
        type: 'object',
        properties: {
          participantId: { type: 'string' },
          visitId: { type: 'string' },
          reason: {
            type: 'string',
            description: 'Clear description of the issue requiring coordinator attention',
          },
          urgency: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Urgency level of the escalation',
          },
        },
        required: ['participantId', 'visitId', 'reason', 'urgency'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sendReminder',
      description: 'Sends a visit reminder to the participant via email or SMS.',
      parameters: {
        type: 'object',
        properties: {
          participantId: { type: 'string' },
          visitId: { type: 'string' },
          channel: {
            type: 'string',
            enum: ['email', 'sms'],
            description: 'Delivery channel for the reminder',
          },
          daysBeforeVisit: {
            type: 'number',
            description: 'How many days before the visit the reminder is for (e.g. 7, 3, 1)',
          },
        },
        required: ['participantId', 'visitId', 'channel', 'daysBeforeVisit'],
        additionalProperties: false,
      },
    },
  },
];
