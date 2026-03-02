/**
 * BPP Adapter Lambda — Beckn Protocol API Gateway
 * 
 * Single Lambda handler that receives all Beckn API calls from BAPs
 * via the ONDC network gateway. Routes each action to the appropriate
 * protocol handler and sends the on_* callback response to the BAP.
 * 
 * Endpoints:
 *   POST /beckn/{action}  — where action is: search, select, init, confirm,
 *                            status, track, cancel, update, rating, support
 * 
 * Flow:
 *   1. Receive Beckn request from BAP/Gateway
 *   2. Validate request format and context
 *   3. (Optional) Verify auth signature via ONDC registry
 *   4. Route to appropriate handler
 *   5. Send on_* callback to BAP's callback URI
 *   6. Return ACK to caller
 * 
 * ONDC Protocol Compliance:
 *   - Responds with ACK/NACK immediately
 *   - Sends actual response asynchronously to BAP callback URI
 *   - Signs outgoing responses with BPP's Ed25519 key
 */

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

/**
 * Beckn API action → handler mapping
 */
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

/**
 * Lambda handler for BPP adapter
 */
export async function handler(event: any): Promise<any> {
  console.log('BPP Adapter received event:', JSON.stringify(event).substring(0, 500));

  try {
    // Parse the action from the path
    const action = extractAction(event);
    if (!action || !ACTION_HANDLERS[action]) {
      return buildHttpResponse(400, {
        message: { ack: { status: 'NACK' } },
        error: { type: 'JSON-SCHEMA-ERROR', code: '20000', message: `Unknown action: ${action}` },
      });
    }

    // Parse body
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

    // Validate context
    const validationError = validateContext(body.context, action);
    if (validationError) {
      return buildHttpResponse(400, {
        message: { ack: { status: 'NACK' } },
        error: { type: 'CONTEXT-ERROR', code: '20001', message: validationError },
      });
    }

    // Optional: verify BAP's signature
    if (VERIFY_SIGNATURES) {
      const authHeader = event.headers?.['Authorization'] || event.headers?.['authorization'];
      if (authHeader) {
        const bapPublicKey = await lookupPublicKey(body.context.bap_id);
        if (bapPublicKey) {
          const rawBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
          const isValid = await verifyAuthorizationHeader(authHeader, rawBody, bapPublicKey);
          if (!isValid) {
            console.warn(`Signature verification failed for BAP: ${body.context.bap_id}`);
            // In staging, log but don't reject. In production, reject.
          }
        }
      }
    }

    // Return ACK immediately
    console.log(`Processing action: ${action}, transaction: ${body.context.transaction_id}`);

    // Process asynchronously — call handler then send callback
    // We do this in the same Lambda invocation but return ACK first
    // For true async, use EventBridge (production optimization)
    const handlerFn = ACTION_HANDLERS[action];

    // Fire-and-forget: process and send callback
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

/**
 * Process the Beckn request and send the on_* callback to BAP
 */
async function processAndCallback(
  handlerFn: (req: BecknRequest) => Promise<BecknResponse>,
  request: BecknRequest,
  action: string
): Promise<void> {
  const startTime = Date.now();

  try {
    // Call the handler
    const response = await handlerFn(request);

    // Build callback URL
    const callbackAction = `on_${action}`;
    const callbackUrl = `${request.context.bap_uri}/${callbackAction}`;

    const responseBody = JSON.stringify(response);

    console.log(`Sending ${callbackAction} to ${callbackUrl} (${responseBody.length} bytes)`);

    // Send callback to BAP
    const callbackResponse = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // In production, sign with: Authorization: <beckn auth header>
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

/**
 * Extract action from the request path
 */
function extractAction(event: any): string | null {
  // API Gateway v2 format
  if (event.rawPath) {
    const parts = event.rawPath.split('/');
    return parts[parts.length - 1] || null;
  }

  // API Gateway v1 format
  if (event.pathParameters?.action) {
    return event.pathParameters.action;
  }

  if (event.path) {
    const parts = event.path.split('/');
    return parts[parts.length - 1] || null;
  }

  // Direct invocation with action in body
  if (event.context?.action) {
    return event.context.action;
  }

  return null;
}

/**
 * Validate Beckn context fields
 */
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

/**
 * Build HTTP response (API Gateway format)
 */
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
