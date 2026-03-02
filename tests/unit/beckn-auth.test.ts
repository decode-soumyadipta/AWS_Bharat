/**
 * Beckn Auth — Unit Tests
 * 
 * Tests Ed25519 signing, verification, and ONDC registry lookup.
 */

// Mock AWS clients
const mockS3Send = jest.fn();
jest.mock('../../src/config/aws-clients', () => ({
  s3Client: { send: mockS3Send },
  KYC_BUCKET_NAME: 'test-kyc-bucket',
}));

import { createAuthorizationHeader, verifyAuthorizationHeader } from '../../src/services/beckn-auth';
import * as crypto from 'crypto';

// Mock fetch for registry lookup
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve([{
    subscriber_id: 'test-bap.ondc.in',
    signing_public_key: 'bW9jay1wdWJsaWMta2V5',
    valid_from: '2024-01-01T00:00:00.000Z',
    valid_until: '2025-12-31T23:59:59.000Z',
  }]),
}) as any;

// Generate a real Ed25519 keypair for testing
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const privateKeyRaw = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(16); // 32-byte raw key
const publicKeyRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(12); // 32-byte raw key

describe('Beckn Auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KYC_BUCKET_NAME = 'test-kyc-bucket';
    process.env.NETWORK_PARTICIPANT_ID = 'vyapar-vaani.ondc.in';
  });

  describe('createAuthorizationHeader', () => {
    test('generates valid authorization header format', async () => {
      // Mock S3 to return the raw private key bytes
      mockS3Send.mockResolvedValue({
        Body: {
          transformToByteArray: () => Promise.resolve(new Uint8Array(privateKeyRaw)),
        },
      });

      const header = await createAuthorizationHeader(
        JSON.stringify({ test: 'data' }),
        'vyapar-vaani.ondc.in',
        'seller-123'
      );

      expect(typeof header).toBe('string');
      expect(header).toContain('Signature');
      expect(header).toContain('keyId=');
      expect(header).toContain('algorithm="ed25519"');
      expect(header).toContain('signature=');
    });

    test('throws when private key not found', async () => {
      mockS3Send.mockRejectedValue(new Error('NoSuchKey'));

      await expect(
        createAuthorizationHeader(
          JSON.stringify({ test: 'data' }),
          'vyapar-vaani.ondc.in',
          'nonexistent-seller'
        )
      ).rejects.toThrow();
    });
  });

  describe('verifyAuthorizationHeader', () => {
    test('rejects empty authorization header', async () => {
      const result = await verifyAuthorizationHeader(
        '',
        JSON.stringify({ test: 'data' }),
        publicKeyRaw.toString('base64')
      );

      expect(result).toBe(false);
    });

    test('rejects malformed authorization header', async () => {
      const result = await verifyAuthorizationHeader(
        'InvalidHeader garbage',
        JSON.stringify({ test: 'data' }),
        publicKeyRaw.toString('base64')
      );

      expect(result).toBe(false);
    });

    test('rejects expired authorization header', async () => {
      const pastCreated = Math.floor(Date.now() / 1000) - 600;
      const pastExpires = pastCreated + 300; // expired 300s ago

      const result = await verifyAuthorizationHeader(
        `Signature keyId="test|key|ed25519",algorithm="ed25519",created="${pastCreated}",expires="${pastExpires}",headers="(created) (expires) digest",signature="aW52YWxpZA=="`,
        JSON.stringify({ test: 'data' }),
        publicKeyRaw.toString('base64')
      );

      expect(result).toBe(false);
    });

    test('round-trip: sign then verify', async () => {
      // Mock S3 for signing with raw bytes
      mockS3Send.mockResolvedValue({
        Body: {
          transformToByteArray: () => Promise.resolve(new Uint8Array(privateKeyRaw)),
        },
      });

      const body = JSON.stringify({ context: { action: 'search' } });

      // Sign
      const header = await createAuthorizationHeader(
        body,
        'vyapar-vaani.ondc.in',
        'seller-123'
      );

      // Verify with matching public key
      const result = await verifyAuthorizationHeader(
        header,
        body,
        publicKeyRaw.toString('base64')
      );

      expect(result).toBe(true);
    });
  });
});
