
import {
  BecknRequest,
  BecknResponse,
  BecknContext,
  BecknAction,
} from '../models/beckn-protocol';
import {
  handleSearch,
  handleSelect,
  handleInit,
  handleConfirm,
  handleStatus,
  handleCancel,
  handleUpdate,
  handleTrack,
  handleRating,
  handleSupport,
} from '../services/beckn-protocol-handler';
import { createAuthorizationHeader, verifyAuthorizationHeader, lookupPublicKey } from '../services/beckn-auth';

const BPP_ID = process.env.NETWORK_PARTICIPANT_ID || 'vyapar-vaani.ondc.in';
const BPP_URI = process.env.BPP_BASE_URL || 'https://api.vyapar-vaani.ondc.in';
const VERIFY_SIGNATURES = process.env.VERIFY_BECKN_SIGNATURES === 'true';

const ACTION_HANDLERS: Record<string, (req: BecknRequest) => Promise<BecknResponse>> = {
  search: handleSearch,
  select: handleSelect,
  init: handleInit,
  confirm: handleConfirm,
  status: handleStatus,
  cancel: handleCancel,
  update: handleUpdate,
  track: handleTrack,
  rating: handleRating,
  support: handleSupport,
};

export async function handler(event: any): Promise<any> {
  console.log('BPP Adapter received event:', JSON.stringify(event).substring(0, 500));

  try {

    const action = extractAction(event);
    if (!action || !ACTION_HANDLERS[action]) {
      return buildHttpResponse(400, {
        message: { ack: { status: 'NACK' } },
        error: { type: 'JSON-SCHEMA-ERROR', code: '20000', message: `Unknown action: ${action}` },
      });
    }

    let body: BecknRequest;
    try {
      if (!event.body) throw new Error('Empty body');
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch {
      return buildHttpResponse(400, {
        message: { ack: { status: 'NACK' } },
        error: { type: 'JSON-SCHEMA-ERROR', code: '20000', message: 'Invalid JSON body' },
      });
    }

    const validationError = validateContext(body.context, action);
    if (validationError) {
      return buildHttpResponse(400, {
        message: { ack: { status: 'NACK' } },
        error: { type: 'CONTEXT-ERROR', code: '20001', message: validationError },
      });
    }

    if (VERIFY_SIGNATURES) {
      const authHeader = event.headers?.['Authorization'] || event.headers?.['authorization'];
      if (authHeader) {
        const bapPublicKey = await lookupPublicKey(body.context.bap_id);
        if (bapPublicKey) {
          const rawBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
          const isValid = await verifyAuthorizationHeader(authHeader, rawBody, bapPublicKey);
          if (!isValid) {
            console.warn(`Signature verification failed for BAP: ${body.context.bap_id}`);

          }
        }
      }
    }

    console.log(`Processing action: ${action}, transaction: ${body.context.transaction_id}`);

    const handlerFn = ACTION_HANDLERS[action];

    processAndCallback(handlerFn, body, action).catch(err => {
      console.error(`Error processing ${action}:`, err);
    });

    return buildHttpResponse(200, {
      message: { ack: { status: 'ACK' } },
    });
  } catch (error) {
    console.error('BPP Adapter error:', error);
    return buildHttpResponse(500, {
      message: { ack: { status: 'NACK' } },
      error: { type: 'INTERNAL-ERROR', code: '30001', message: 'Internal server error' },
    });
  }
}

async function processAndCallback(
  handlerFn: (req: BecknRequest) => Promise<BecknResponse>,
  request: BecknRequest,
  action: string
): Promise<void> {
  const startTime = Date.now();

  try {

    const response = await handlerFn(request);

    const callbackAction = `on_${action}`;
    const callbackUrl = `${request.context.bap_uri}/${callbackAction}`;

    const responseBody = JSON.stringify(response);

    console.log(`Sending ${callbackAction} to ${callbackUrl} (${responseBody.length} bytes)`);

    const callbackResponse = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',

      },
      body: responseBody,
    });

    const elapsed = Date.now() - startTime;
    console.log(`${callbackAction} sent to BAP in ${elapsed}ms, status: ${callbackResponse.status}`);

    if (!callbackResponse.ok) {
      const errorText = await callbackResponse.text();
      console.error(`BAP callback failed: ${callbackResponse.status} — ${errorText}`);
    }
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`Failed to process ${action} after ${elapsed}ms:`, error);
  }
}

function extractAction(event: any): string | null {

  if (event.rawPath) {
    const parts = event.rawPath.split('/');
    return parts[parts.length - 1] || null;
  }

  if (event.pathParameters?.action) {
    return event.pathParameters.action;
  }

  if (event.path) {
    const parts = event.path.split('/');
    return parts[parts.length - 1] || null;
  }

  if (event.context?.action) {
    return event.context.action;
  }

  return null;
}

function validateContext(context: BecknContext, expectedAction: string): string | null {
  if (!context) return 'Missing context';
  if (!context.domain) return 'Missing context.domain';
  if (!context.bap_id) return 'Missing context.bap_id';
  if (!context.bap_uri) return 'Missing context.bap_uri';
  if (!context.transaction_id) return 'Missing context.transaction_id';
  if (!context.message_id) return 'Missing context.message_id';
  if (!context.timestamp) return 'Missing context.timestamp';
  if (context.action !== expectedAction) return `Expected action '${expectedAction}', got '${context.action}'`;
  if (context.core_version !== '1.2.0') return `Unsupported core_version: ${context.core_version}`;
  return null;
}

function buildHttpResponse(statusCode: number, body: any): any {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(body),
  };
}
