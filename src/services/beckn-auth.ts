
import * as crypto from 'crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, KYC_BUCKET_NAME } from '../config/aws-clients';

const SIGNING_ALGORITHM = 'ed25519';
const SIGNATURE_VALIDITY_SECONDS = 300; 

export async function createAuthorizationHeader(
  body: string,
  subscriberId: string,
  sellerId: string,
  keyId: string = 'default'
): Promise<string> {
  const privateKeyBase64 = await getPrivateKey(sellerId);
  if (!privateKeyBase64) {
    throw new Error(`Private key not found for seller: ${sellerId}`);
  }

  const created = Math.floor(Date.now() / 1000);
  const expires = created + SIGNATURE_VALIDITY_SECONDS;

  const digest = createDigest(body);

  const signingString = `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;

  const privateKeyBuffer = Buffer.from(privateKeyBase64, 'base64');
  const signature = crypto.sign(null, Buffer.from(signingString), {
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      privateKeyBuffer,
    ]),
    format: 'der',
    type: 'pkcs8',
  });

  const signatureBase64 = signature.toString('base64');

  return `Signature keyId="${subscriberId}|${keyId}|${SIGNING_ALGORITHM}",algorithm="${SIGNING_ALGORITHM}",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signatureBase64}"`;
}

export async function verifyAuthorizationHeader(
  authHeader: string,
  body: string,
  publicKeyBase64: string
): Promise<boolean> {
  try {
    const parsed = parseAuthHeader(authHeader);
    if (!parsed) return false;

    const now = Math.floor(Date.now() / 1000);
    if (now > parseInt(parsed.expires)) {
      console.warn('Authorization header expired');
      return false;
    }

    const digest = createDigest(body);
    const signingString = `(created): ${parsed.created}\n(expires): ${parsed.expires}\ndigest: BLAKE-512=${digest}`;

    const publicKeyBuffer = Buffer.from(publicKeyBase64, 'base64');
    const signatureBuffer = Buffer.from(parsed.signature, 'base64');

    return crypto.verify(
      null,
      Buffer.from(signingString),
      {
        key: Buffer.concat([
          Buffer.from('302a300506032b6570032100', 'hex'),
          publicKeyBuffer,
        ]),
        format: 'der',
        type: 'spki',
      },
      signatureBuffer
    );
  } catch (error) {
    console.error('Auth verification failed:', error);
    return false;
  }
}

function createDigest(body: string): string {
  try {
    const hash = crypto.createHash('blake2b512');
    hash.update(body);
    return hash.digest('base64');
  } catch {

    const hash = crypto.createHash('sha512');
    hash.update(body);
    return hash.digest('base64');
  }
}

function parseAuthHeader(header: string): {
  keyId: string;
  algorithm: string;
  created: string;
  expires: string;
  headers: string;
  signature: string;
} | null {
  try {
    const signaturePrefix = 'Signature ';
    const signaturePart = header.startsWith(signaturePrefix)
      ? header.substring(signaturePrefix.length)
      : header;

    const params: Record<string, string> = {};
    const regex = /(\w+)="([^"]*)"/g;
    let match;
    while ((match = regex.exec(signaturePart)) !== null) {
      params[match[1]] = match[2];
    }

    if (!params.keyId || !params.signature || !params.created || !params.expires) {
      return null;
    }

    return {
      keyId: params.keyId,
      algorithm: params.algorithm || 'ed25519',
      created: params.created,
      expires: params.expires,
      headers: params.headers || '',
      signature: params.signature,
    };
  } catch {
    return null;
  }
}

async function getPrivateKey(sellerId: string): Promise<string | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: KYC_BUCKET_NAME,
      Key: `kyc-documents/${sellerId}/private_key.pem`,
    });

    const response = await s3Client.send(command);
    const body = await response.Body?.transformToByteArray();
    if (!body) return null;

    return Buffer.from(body).toString('base64');
  } catch (error: any) {
    if (error.name === 'NoSuchKey') return null;
    throw error;
  }
}

export async function lookupPublicKey(
  subscriberId: string,
  registryUrl: string = 'https://registry.ondc.org/ondc/vlookup'
): Promise<string | null> {
  try {
    const response = await fetch(`${registryUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        type: 'BAP',
        domain: 'ONDC:RET10',
        country: 'IND',
      }),
    });

    if (!response.ok) {
      console.warn(`Registry lookup failed for ${subscriberId}: ${response.status}`);
      return null;
    }

    const data = await response.json() as any[];
    if (data && data.length > 0) {
      return data[0].signing_public_key || null;
    }
    return null;
  } catch (error) {
    console.error('Registry lookup error:', error);
    return null;
  }
}
