/**
 * Unit Tests for Intent Classification Lambda
 * 
 * Tests intent classification using Claude 3.5 Sonnet for various
 * voice note transcriptions in different languages.
 * 
 * Validates: Requirements 2.2, 4.3, 12.8
 */

import { handler } from '../../src/lambdas/intent-classification';
import { bedrockClient } from '../../src/config/aws-clients';
import { IntentClassificationRequest } from '../../src/models/intent';

// Mock AWS SDK clients
jest.mock('../../src/config/aws-clients', () => ({
  bedrockClient: {
    send: jest.fn(),
  },
}));

describe('Intent Classification Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CREATE_CATALOG intent', () => {
    it('should classify Hindi catalog creation intent correctly', async () => {
      // Mock Claude response
      const mockClaudeResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'CREATE_CATALOG',
              confidence: 0.95,
              language: 'hi',
            }),
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'मैं 5 किलो आम का अचार 200 रुपये में बेचना चाहता हूं',
        language: 'hi-IN',
        sellerId: 'seller-123',
        messageId: 'msg-456',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.intent).toBe('CREATE_CATALOG');
      expect(response.confidence).toBe(0.95);
      expect(response.language).toBe('hi');
      expect(response.needsClarification).toBe(false);
    });

    it('should classify English catalog creation intent correctly', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'CREATE_CATALOG',
              confidence: 0.92,
              language: 'en',
            }),
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'I want to sell mango pickle for 200 rupees, 5 kg',
        language: 'en-IN',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.intent).toBe('CREATE_CATALOG');
      expect(response.confidence).toBe(0.92);
      expect(response.language).toBe('en');
    });

    it('should classify Marathi catalog creation intent correctly', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'CREATE_CATALOG',
              confidence: 0.88,
              language: 'mr',
            }),
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'मी आंब्याचे लोणचे 200 रुपयांना विकायचे आहे',
        language: 'mr-IN',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.intent).toBe('CREATE_CATALOG');
      expect(response.language).toBe('mr');
    });
  });

  describe('UPDATE_INVENTORY intent', () => {
    it('should classify inventory update intent correctly', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'UPDATE_INVENTORY',
              confidence: 0.91,
              language: 'hi',
            }),
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'स्टॉक को 50 पैकेट में अपडेट करें',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.intent).toBe('UPDATE_INVENTORY');
      expect(response.confidence).toBe(0.91);
    });
  });

  describe('Order management intents', () => {
    it('should classify ACCEPT_ORDER intent correctly', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'ACCEPT_ORDER',
              confidence: 0.96,
              language: 'hi',
            }),
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'ऑर्डर स्वीकार करें',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.intent).toBe('ACCEPT_ORDER');
    });

    it('should classify REJECT_ORDER intent correctly', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'REJECT_ORDER',
              confidence: 0.94,
              language: 'hi',
            }),
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'ऑर्डर अस्वीकार करें',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.intent).toBe('REJECT_ORDER');
    });

    it('should classify UPDATE_FULFILLMENT intent correctly', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'UPDATE_FULFILLMENT',
              confidence: 0.89,
              language: 'hi',
            }),
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'ऑर्डर पैक हो गया है और भेजने के लिए तैयार है',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.intent).toBe('UPDATE_FULFILLMENT');
    });

    it('should classify QUERY_STATUS intent correctly', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'QUERY_STATUS',
              confidence: 0.87,
              language: 'en',
            }),
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'What is the status of my order?',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.intent).toBe('QUERY_STATUS');
    });
  });

  describe('Low confidence handling', () => {
    it('should flag for clarification when confidence is below 70%', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'CREATE_CATALOG',
              confidence: 0.65,
              language: 'hi',
            }),
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'कुछ बेचना है',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.confidence).toBe(0.65);
      expect(response.needsClarification).toBe(true);
    });

    it('should not flag for clarification when confidence is 70% or above', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'CREATE_CATALOG',
              confidence: 0.7,
              language: 'hi',
            }),
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'नया उत्पाद जोड़ें',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.confidence).toBe(0.7);
      expect(response.needsClarification).toBe(false);
    });
  });

  describe('Code-mixed input handling', () => {
    it('should handle code-mixed Hindi-English input', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'CREATE_CATALOG',
              confidence: 0.93,
              language: 'hi',
            }),
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'Mango pickle 200 rupees 5 kg बेचना है',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.intent).toBe('CREATE_CATALOG');
      expect(response.confidence).toBeGreaterThan(0.7);
    });
  });

  describe('Error handling', () => {
    it('should handle empty transcribed text', async () => {
      const request: IntentClassificationRequest = {
        transcribedText: '',
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('required');
    });

    it('should handle Bedrock API errors', async () => {
      (bedrockClient.send as jest.Mock).mockRejectedValue(
        new Error('Bedrock service unavailable')
      );

      const request: IntentClassificationRequest = {
        transcribedText: 'Test text',
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Bedrock service unavailable');
    });

    it('should handle invalid JSON response from Claude', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: 'This is not valid JSON',
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'Test text',
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Invalid JSON');
    });

    it('should handle response with markdown code blocks', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: '```json\n{"intent": "CREATE_CATALOG", "confidence": 0.9, "language": "hi"}\n```',
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'Test text',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.intent).toBe('CREATE_CATALOG');
      expect(response.confidence).toBe(0.9);
    });
  });

  describe('Prompt construction', () => {
    it('should invoke Claude with correct model ID and parameters', async () => {
      const mockClaudeResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'CREATE_CATALOG',
              confidence: 0.9,
              language: 'hi',
            }),
          },
        ],
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const request: IntentClassificationRequest = {
        transcribedText: 'Test transcription',
      };

      await handler(request);

      expect(bedrockClient.send).toHaveBeenCalledTimes(1);
      const callArgs = (bedrockClient.send as jest.Mock).mock.calls[0][0];
      
      expect(callArgs.input.modelId).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0');
      expect(callArgs.input.contentType).toBe('application/json');
      
      const requestBody = JSON.parse(callArgs.input.body);
      expect(requestBody.temperature).toBe(0.0);
      expect(requestBody.max_tokens).toBe(500);
      expect(requestBody.messages[0].content).toContain('Test transcription');
    });
  });
});
