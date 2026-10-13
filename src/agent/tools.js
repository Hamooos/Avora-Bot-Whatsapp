'use strict';

const HANDOFF_CATEGORIES = [
  'human_request',
  'cancel_refund',
  'complaint',
  'medical',
  'unknown_info',
  'order_issue',
  'other',
];

// Order matters for prompt caching: keep this list stable.
const TOOL_DEFINITIONS = [
  {
    name: 'lookup_order',
    description:
      'Look up the status of a Shopify order (read-only). Requires the order number. ' +
      'The phone defaults to the number the customer is writing from; pass phone only if the customer said the order was placed with a different number. ' +
      'Returns found:false when there is no order matching BOTH the number and the phone.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        order_number: { type: 'string', description: 'Order number as the customer wrote it, e.g. "1001" or "#1001".' },
        phone: { type: 'string', description: 'Phone number on the order. Omit unless it differs from the sender.' },
      },
      required: ['order_number'],
      additionalProperties: false,
    },
  },
  {
    name: 'handoff_to_human',
    description:
      'Notify the Avora team that a human must take over this conversation. ' +
      'Use for: requests for a person, cancellation/return/refund, complaints or faulty device, medical red flags, ' +
      'and any question the knowledge documents do not answer. After calling it, tell the customer the team will get back to them.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: HANDOFF_CATEGORIES },
        summary: { type: 'string', description: 'One or two short Hebrew sentences for the owner: what the customer needs.' },
      },
      required: ['category', 'summary'],
      additionalProperties: false,
    },
  },
];

module.exports = { TOOL_DEFINITIONS, HANDOFF_CATEGORIES };
