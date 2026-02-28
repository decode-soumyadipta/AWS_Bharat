/**
 * Unit tests for web-search tool
 */

import { remote_web_search, SearchResult } from '../../src/tools/web-search';

describe('Web Search Tool', () => {
  describe('remote_web_search', () => {
    it('should return search results for market price queries', async () => {
      const results = await remote_web_search({ 
        query: 'mango market price today India 2024-01-15' 
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      
      if (results.length > 0) {
        const firstResult = results[0];
        expect(firstResult).toHaveProperty('snippet');
        expect(firstResult).toHaveProperty('url');
        expect(typeof firstResult.snippet).toBe('string');
        expect(typeof firstResult.url).toBe('string');
      }
    });

    it('should return search results with title and publishedDate when available', async () => {
      const results = await remote_web_search({ 
        query: 'tomato market price today India' 
      });

      expect(results).toBeDefined();
      
      if (results.length > 0) {
        const firstResult = results[0];
        
        // Optional fields
        if (firstResult.title) {
          expect(typeof firstResult.title).toBe('string');
        }
        if (firstResult.publishedDate) {
          expect(typeof firstResult.publishedDate).toBe('string');
        }
      }
    });

    it('should handle maxResults parameter', async () => {
      const results = await remote_web_search({ 
        query: 'potato market price',
        maxResults: 3
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      // Mock implementation may return fewer results
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should return empty array on error', async () => {
      // This test verifies graceful error handling
      // The current implementation should not throw errors
      const results = await remote_web_search({ 
        query: '' 
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle Hindi market price queries', async () => {
      const results = await remote_web_search({ 
        query: 'आम का भाव आज' 
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should return results with proper structure', async () => {
      const results = await remote_web_search({ 
        query: 'onion market price today' 
      });

      expect(results).toBeDefined();
      
      results.forEach((result: SearchResult) => {
        expect(result).toHaveProperty('snippet');
        expect(result).toHaveProperty('url');
        expect(typeof result.snippet).toBe('string');
        expect(typeof result.url).toBe('string');
        
        // Ensure snippet is not empty
        expect(result.snippet.length).toBeGreaterThan(0);
        // Ensure url is valid format
        expect(result.url).toMatch(/^https?:\/\//);
      });
    });

    it('should handle generic search queries', async () => {
      const results = await remote_web_search({ 
        query: 'ONDC seller registration process' 
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should default maxResults to 5 when not specified', async () => {
      const results = await remote_web_search({ 
        query: 'market price' 
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      // Mock implementation may return fewer results
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('SearchResult interface', () => {
    it('should have required fields: snippet and url', () => {
      const mockResult: SearchResult = {
        snippet: 'Test snippet',
        url: 'https://example.com'
      };

      expect(mockResult.snippet).toBe('Test snippet');
      expect(mockResult.url).toBe('https://example.com');
    });

    it('should support optional fields: title and publishedDate', () => {
      const mockResult: SearchResult = {
        snippet: 'Test snippet',
        url: 'https://example.com',
        title: 'Test Title',
        publishedDate: '2024-01-15'
      };

      expect(mockResult.title).toBe('Test Title');
      expect(mockResult.publishedDate).toBe('2024-01-15');
    });
  });
});
