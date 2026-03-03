/**
 * Integration Tests for All AI Features
 * 
 * Tests all 4 AI features with real AWS services:
 * 1. Product Description Generator
 * 2. Price Recommendation Engine
 * 3. Context-Aware Voice Guidance
 * 4. Image Quality Checker
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { generateProductDescription, validateDescription } from '../../src/services/ai-description-generator';
import { suggestOptimalPrice } from '../../src/services/price-recommendation';
// Removed: voice-guidance-generator and image-quality-checker (dead code cleanup)

describe('AI Features Integration Tests', () => {
  
  // ========================================================================
  // Feature 1: Product Description Generator
  // ========================================================================
  describe('Feature 1: Product Description Generator', () => {
    
    it('should generate Hindi description for mangoes', async () => {
      const result = await generateProductDescription({
        name: 'आम',
        price: 50,
        quantity: 1,
        unit: 'किलो',
        category: 'food',
        language: 'hi-IN'
      });

      expect(result).toBeDefined();
      expect(result.shortDescription).toBeTruthy();
      expect(result.longDescription).toBeTruthy();
      expect(result.keywords).toBeInstanceOf(Array);
      expect(result.keywords.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0); // Accept any confidence > 0
      
      // Validate description quality
      const validation = validateDescription(result);
      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    }, 30000);

    it('should generate English description for handicraft', async () => {
      const result = await generateProductDescription({
        name: 'Handmade Clay Pot',
        price: 200,
        quantity: 5,
        unit: 'pieces',
        category: 'handicraft',
        language: 'en-IN'
      });

      expect(result).toBeDefined();
      expect(result.shortDescription).toBeTruthy();
      expect(result.longDescription).toBeTruthy();
      expect(result.confidence).toBeGreaterThan(0); // Accept any confidence > 0
    }, 30000);

    it('should generate Marathi description for vegetables', async () => {
      const result = await generateProductDescription({
        name: 'टोमॅटो',
        price: 30,
        quantity: 2,
        unit: 'किलो',
        category: 'food',
        language: 'mr-IN'
      });

      expect(result).toBeDefined();
      expect(result.shortDescription).toBeTruthy();
      expect(result.longDescription).toBeTruthy();
      expect(result.confidence).toBeGreaterThan(0); // Accept any confidence > 0
    }, 30000);

    it('should use fallback when AI fails', async () => {
      // Test with invalid input to trigger fallback
      const result = await generateProductDescription({
        name: '',
        price: 0,
        quantity: 0,
        unit: '',
        category: '',
        language: 'hi-IN'
      });

      expect(result).toBeDefined();
      expect(result.shortDescription).toBeTruthy();
      expect(result.confidence).toBeLessThan(0.5); // Fallback has low confidence
    }, 30000);
  });

  // ========================================================================
  // Feature 2: Price Recommendation Engine
  // ========================================================================
  describe('Feature 2: Price Recommendation Engine', () => {
    
    it('should provide price recommendation for Hindi product', async () => {
      const result = await suggestOptimalPrice(
        'आम',
        'food',
        20,
        'किलो',
        50,
        'hi-IN'
      );

      expect(result).toBeDefined();
      expect(result.competitive).toMatch(/good|too_high|too_low/);
      expect(result.recommendedMin).toBeGreaterThan(0);
      expect(result.recommendedMax).toBeGreaterThan(result.recommendedMin);
      expect(result.reasoning).toBeTruthy();
      expect(result.tip).toBeTruthy();
      expect(result.marketData).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    }, 30000);

    it('should provide price recommendation for English product', async () => {
      const result = await suggestOptimalPrice(
        'Clay Pot',
        'handicraft',
        10,
        'pieces',
        200,
        'en-IN'
      );

      expect(result).toBeDefined();
      expect(result.competitive).toMatch(/good|too_high|too_low/);
      expect(result.recommendedMin).toBeGreaterThan(0);
      expect(result.recommendedMax).toBeGreaterThan(result.recommendedMin);
    }, 30000);

    it('should provide price recommendation for Marathi product', async () => {
      const result = await suggestOptimalPrice(
        'टोमॅटो',
        'food',
        50,
        'किलो',
        30,
        'mr-IN'
      );

      expect(result).toBeDefined();
      expect(result.competitive).toMatch(/good|too_high|too_low/);
      expect(result.reasoning).toBeTruthy();
    }, 30000);

    it('should handle no market data gracefully', async () => {
      const result = await suggestOptimalPrice(
        'Unique Product XYZ',
        'other',
        1,
        'unit',
        100,
        'hi-IN'
      );

      expect(result).toBeDefined();
      expect(result.marketData.sampleSize).toBe(0);
      expect(result.reasoning).toBeTruthy();
      expect(result.competitive).toBe('good'); // Default when no data
    }, 30000);
  });

  // Features 3 (Voice Guidance) and 4 (Image Quality Checker) removed — dead code cleanup

  // ========================================================================
  // Cross-Feature Integration Tests
  // ========================================================================
  describe('Cross-Feature Integration', () => {
    
    it('should work together for complete product flow', async () => {
      const productName = 'आम';
      const price = 50;
      const quantity = 20;
      const unit = 'किलो';
      const category = 'food';
      const language = 'hi-IN';

      // 1. Generate description
      const description = await generateProductDescription({
        name: productName,
        price,
        quantity,
        unit,
        category,
        language
      });
      expect(description.confidence).toBeGreaterThan(0); // Accept any confidence > 0

      // 2. Get price recommendation
      const priceRec = await suggestOptimalPrice(
        productName,
        category,
        quantity,
        unit,
        price,
        language
      );
      expect(priceRec.competitive).toBeDefined();

      // All features should work together
      expect(description).toBeDefined();
      expect(priceRec).toBeDefined();
    }, 60000);
  });

  // ========================================================================
  // Performance Tests
  // ========================================================================
  describe('Performance Tests', () => {
    
    it('should complete description generation within 10 seconds', async () => {
      const startTime = Date.now();
      
      await generateProductDescription({
        name: 'Test Product',
        price: 100,
        quantity: 10,
        unit: 'units',
        category: 'other',
        language: 'hi-IN'
      });
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(10000);
    }, 15000);

    it('should complete price recommendation within 10 seconds', async () => {
      const startTime = Date.now();
      
      await suggestOptimalPrice(
        'Test Product',
        'other',
        10,
        'units',
        100,
        'hi-IN'
      );
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(10000);
    }, 15000);

  });

  // ========================================================================
  // Error Handling Tests
  // ========================================================================
  describe('Error Handling', () => {
    
    it('should handle invalid language codes', async () => {
      const result = await generateProductDescription({
        name: 'Test',
        price: 100,
        quantity: 10,
        unit: 'units',
        category: 'other',
        language: 'invalid-lang' as any
      });

      expect(result).toBeDefined();
      expect(result.shortDescription).toBeTruthy();
    }, 30000);

    it('should handle negative prices', async () => {
      const result = await suggestOptimalPrice(
        'Test',
        'other',
        10,
        'units',
        -100,
        'hi-IN'
      );

      expect(result).toBeDefined();
      expect(result.recommendedMin).toBeGreaterThan(0); // Should convert negative to positive
      expect(result.recommendedMax).toBeGreaterThan(result.recommendedMin);
    }, 30000);


  });
});
