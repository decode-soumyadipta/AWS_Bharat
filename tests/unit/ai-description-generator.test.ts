/**
 * Unit Tests for AI Description Generator
 */

import { describe, it, expect } from '@jest/globals';
import { validateDescription } from '../../src/services/ai-description-generator';
import type { GeneratedDescription } from '../../src/services/ai-description-generator';

describe('AI Description Generator - Unit Tests', () => {
  
  describe('validateDescription', () => {
    
    it('should validate a good description', () => {
      const description: GeneratedDescription = {
        shortDescription: 'Fresh Mangoes',
        longDescription: 'Fresh mangoes from local farm. Sweet and juicy.',
        keywords: ['mango', 'fresh', 'fruit'],
        highlights: ['Fresh', 'Sweet', 'Local'],
        confidence: 0.9
      };

      const result = validateDescription(description);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should reject description with too long short description', () => {
      const description: GeneratedDescription = {
        shortDescription: 'A'.repeat(150),
        longDescription: 'Test description',
        keywords: ['test'],
        highlights: ['test'],
        confidence: 0.9
      };

      const result = validateDescription(description);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Short description too long');
    });

    it('should reject description with too long long description', () => {
      const description: GeneratedDescription = {
        shortDescription: 'Test',
        longDescription: 'A'.repeat(600),
        keywords: ['test'],
        highlights: ['test'],
        confidence: 0.9
      };

      const result = validateDescription(description);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Long description too long');
    });

    it('should reject description with inappropriate words', () => {
      const description: GeneratedDescription = {
        shortDescription: 'Fake Product',
        longDescription: 'This is a fake product',
        keywords: ['fake'],
        highlights: ['fake'],
        confidence: 0.9
      };

      const result = validateDescription(description);
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should reject description with too many exclamation marks', () => {
      const description: GeneratedDescription = {
        shortDescription: 'Amazing Product!!!!',
        longDescription: 'Buy now!!!! Best deal ever!!!!',
        keywords: ['test'],
        highlights: ['test'],
        confidence: 0.9
      };

      const result = validateDescription(description);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Too many exclamation marks');
    });
  });
});
