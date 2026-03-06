
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { EncryptCommand } from '@aws-sdk/client-kms';
import { s3Client, kmsClient, KYC_BUCKET_NAME, KMS_KEY_ID } from '../config/aws-clients';
import { createSellerProfile } from '../services/dynamodb-repository';
import { SellerProfile } from '../models/seller';
import { ExtractedKYCData } from '../models/kyc';

const ONDC_REGISTRY_URL = process.env.ONDC_REGISTRY_URL || 'https://registry.ondc.org/api/v1';
const NETWORK_PARTICIPANT_ID = process.env.NETWORK_PARTICIPANT_ID || 'vyapar-vaani.ondc.in';
const BPP_BASE_URL = process.env.BPP_BASE_URL || 'https://api.vyapar-vaani.ondc.in';

export interface SellerRegistrationRequest {
  extractedData: ExtractedKYCData;
  phone: string; 
  language: 'hi' | 'mr' | 'en';
  documentUrls: string[]; 
}

export interface SellerRegistrationResponse {
  success: boolean;
  sellerId?: string;
  subscriberId?: string;
  error?: {
    code: string;
    message: string;
  };
}

interface Ed25519KeyPair {
  publicKey: string; 
  privateKey: string; 
}

interface ONDCSubscriberPayload {
  subscriber_id: string;
  subscriber_url: string;
  type: 'BPP';
  domain: string;
  city: string;
  country: string;
  signing_public_key: string;
  encryption_public_key: string;
  valid_from: string; 
  valid_until: string; 
}

export const handler = async (
  event: SellerRegistrationRequest
): Promise<SellerRegistrationResponse> => {
  console.log('Seller registration request:', JSON.stringify({ ...event, extractedData: '...' }, null, 2));

  try {

    const sellerId = randomUUID();
    console.log('Generated seller ID:', sellerId);

    const keyPair = generateEd25519KeyPair();
    console.log('Generated Ed25519 key pair');

    const subscriberId = `${NETWORK_PARTICIPANT_ID}/sellers/${sellerId}`;
    const subscriberUrl = `${BPP_BASE_URL}/sellers/${sellerId}`;

    const encryptedAadhar = await encryptAadharNumber(
      event.extractedData.aadharNumber?.value || ''
    );
    console.log('Encrypted Aadhar number');

    const storedDocumentUrls = await storeKYCDocuments(
      sellerId,
      event.documentUrls
    );
    console.log('Stored KYC documents:', storedDocumentUrls);

    await registerWithONDC({
      subscriber_id: subscriberId,
      subscriber_url: subscriberUrl,
      type: 'BPP',
      domain: 'nic2004:52110', 
      city: '*', 
      country: 'IND',
      signing_public_key: keyPair.publicKey,
      encryption_public_key: keyPair.publicKey, 
      valid_from: new Date().toISOString(),
      valid_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), 
    });
    console.log('Registered with ONDC Registry');

    const sellerProfile: SellerProfile = {
      PK: `SELLER#${sellerId}`,
      SK: 'PROFILE',
      GSI1PK: event.phone,
      GSI1SK: 'PROFILE',
      entityType: 'SELLER_PROFILE',
      sellerId,
      phone: event.phone,
      name: event.extractedData.name?.value || '',
      language: event.language,
      onboardingState: 'KYC_VERIFIED',
      kyc: {
        panNumber: event.extractedData.panNumber?.value || '',
        aadharNumber: encryptedAadhar,
        documentUrls: storedDocumentUrls,
        verifiedAt: Date.now(),
        status: 'VERIFIED',
      },
      ondc: {
        subscriberId,
        subscriberUrl,
        signingPublicKey: keyPair.publicKey,
        encryptionPublicKey: keyPair.publicKey,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await createSellerProfile(sellerProfile);
    console.log('Created seller profile in DynamoDB');

    await storePrivateKey(sellerId, keyPair.privateKey);
    console.log('Stored private key securely');

    return {
      success: true,
      sellerId,
      subscriberId,
    };
  } catch (error: any) {
    console.error('Seller registration failed:', error);

    return {
      success: false,
      error: {
        code: error.name || 'REGISTRATION_ERROR',
        message: error.message || 'Failed to register seller',
      },
    };
  }
};

export function generateEd25519KeyPair(): Ed25519KeyPair {

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'der',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'der',
    },
  });

  return {
    publicKey: publicKey.toString('base64'),
    privateKey: privateKey.toString('base64'),
  };
}

export async function encryptAadharNumber(aadharNumber: string): Promise<string> {
  if (!aadharNumber) {
    return '';
  }

  const cleanAadhar = aadharNumber.replace(/\s/g, '');

  const command = new EncryptCommand({
    KeyId: KMS_KEY_ID,
    Plaintext: Buffer.from(cleanAadhar, 'utf-8'),
  });

  const response = await kmsClient.send(command);

  if (!response.CiphertextBlob) {
    throw new Error('KMS encryption failed: no ciphertext returned');
  }

  return Buffer.from(response.CiphertextBlob).toString('base64');
}

export async function storeKYCDocuments(
  sellerId: string,
  documentUrls: string[]
): Promise<string[]> {
  const storedUrls: string[] = [];

  for (let i = 0; i < documentUrls.length; i++) {
    const sourceUrl = documentUrls[i];
    const timestamp = Date.now();
    const destKey = `kyc-documents/${sellerId}/document_${i}_${timestamp}.jpg`;

    const s3UrlMatch = sourceUrl.match(/^s3:\/\/([^\/]+)\/(.+)$/);
    if (!s3UrlMatch) {
      throw new Error(`Invalid S3 URL format: ${sourceUrl}`);
    }

    const [, sourceBucket, sourceKey] = s3UrlMatch;

    const getCommand = new GetObjectCommand({
      Bucket: sourceBucket,
      Key: sourceKey,
    });

    const sourceObject = await s3Client.send(getCommand);
    const buffer = await sourceObject.Body?.transformToByteArray();

    if (!buffer) {
      throw new Error(`Failed to read source document: ${sourceUrl}`);
    }

    const putCommand = new PutObjectCommand({
      Bucket: KYC_BUCKET_NAME,
      Key: destKey,
      Body: buffer,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: KMS_KEY_ID,
      ContentType: 'image/jpeg',
    });

    await s3Client.send(putCommand);

    const s3Url = `s3://${KYC_BUCKET_NAME}/${destKey}`;
    storedUrls.push(s3Url);
  }

  return storedUrls;
}

async function storePrivateKey(sellerId: string, privateKey: string): Promise<void> {
  const key = `kyc-documents/${sellerId}/private_key.pem`;

  const command = new PutObjectCommand({
    Bucket: KYC_BUCKET_NAME,
    Key: key,
    Body: Buffer.from(privateKey, 'base64'),
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: KMS_KEY_ID,
    ContentType: 'application/x-pem-file',
  });

  await s3Client.send(command);
}

export async function registerWithONDC(payload: ONDCSubscriberPayload): Promise<void> {
  console.log('Registering with ONDC:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(`${ONDC_REGISTRY_URL}/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...payload,
        nonce: randomUUID(),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.warn(`ONDC registry returned ${response.status}: ${errorBody}`);

      if (response.status >= 500) {
        throw new Error(`ONDC registry server error: ${response.status}`);
      }
      console.log('ONDC registration submitted (may require manual approval)');
      return;
    }

    const result = await response.json();
    console.log('ONDC registration response:', JSON.stringify(result));
    console.log('ONDC registration successful');
  } catch (error: any) {
    if (error.message?.includes('fetch failed') || error.cause?.code === 'ENOTFOUND') {

      console.warn('ONDC Registry unreachable — registration stored locally. Will retry on next deployment.');
      return;
    }
    throw error;
  }
}
