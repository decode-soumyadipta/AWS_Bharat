/**
 * Unit tests for ShoppingCart class
 * 
 * Tests core operations: addItem, removeItem, updateQuantity, getItems, getTotalPrice, clear
 * Tests persistence: saveToStorage, loadFromStorage
 * 
 * Requirements: 2.2, 2.8, 7.4, 7.5
 */

const ShoppingCart = require('../../marketplace/ShoppingCart');

describe('ShoppingCart', () => {
  let cart;

  beforeEach(() => {
    cart = new ShoppingCart();
    // Mock localStorage
    global.localStorage = {
      data: {},
      getItem(key) {
        return this.data[key] || null;
      },
      setItem(key, value) {
        this.data[key] = value;
      },
      removeItem(key) {
        delete this.data[key];
      },
      clear() {
        this.data = {};
      }
    };
  });

  describe('addItem', () => {
    test('should add a new item to the cart', () => {
      cart.addItem('product1', 2, {
        name: 'Test Product',
        price: 100,
        seller: 'Test Seller',
        unit: 'kg'
      });

      const items = cart.getItems();
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({
        productId: 'product1',
        quantity: 2,
        name: 'Test Product',
        price: 100,
        seller: 'Test Seller',
        unit: 'kg'
      });
    });

    test('should increment quantity when adding existing item', () => {
      cart.addItem('product1', 2, { name: 'Test', price: 100 });
      cart.addItem('product1', 3, { name: 'Test', price: 100 });

      const items = cart.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(5);
    });

    test('should throw error when productId is missing', () => {
      expect(() => cart.addItem('', 1)).toThrow('Product ID is required');
      expect(() => cart.addItem(null, 1)).toThrow('Product ID is required');
    });

    test('should throw error when quantity is less than 1', () => {
      expect(() => cart.addItem('product1', 0)).toThrow('Quantity must be at least 1');
      expect(() => cart.addItem('product1', -1)).toThrow('Quantity must be at least 1');
    });

    test('should handle multiple different products', () => {
      cart.addItem('product1', 1, { name: 'Product 1', price: 100 });
      cart.addItem('product2', 2, { name: 'Product 2', price: 200 });
      cart.addItem('product3', 3, { name: 'Product 3', price: 300 });

      const items = cart.getItems();
      expect(items).toHaveLength(3);
    });
  });

  describe('removeItem', () => {
    test('should remove an item from the cart', () => {
      cart.addItem('product1', 2, { name: 'Test', price: 100 });
      cart.addItem('product2', 1, { name: 'Test 2', price: 200 });

      const removed = cart.removeItem('product1');

      expect(removed).toBe(true);
      expect(cart.getItems()).toHaveLength(1);
      expect(cart.getItems()[0].productId).toBe('product2');
    });

    test('should return false when removing non-existent item', () => {
      cart.addItem('product1', 1, { name: 'Test', price: 100 });

      const removed = cart.removeItem('product999');

      expect(removed).toBe(false);
      expect(cart.getItems()).toHaveLength(1);
    });

    test('should throw error when productId is missing', () => {
      expect(() => cart.removeItem('')).toThrow('Product ID is required');
      expect(() => cart.removeItem(null)).toThrow('Product ID is required');
    });

    test('should handle removing from empty cart', () => {
      const removed = cart.removeItem('product1');
      expect(removed).toBe(false);
      expect(cart.getItems()).toHaveLength(0);
    });
  });

  describe('updateQuantity', () => {
    test('should update quantity of existing item', () => {
      cart.addItem('product1', 2, { name: 'Test', price: 100 });

      const updated = cart.updateQuantity('product1', 5);

      expect(updated).toBe(true);
      expect(cart.getItems()[0].quantity).toBe(5);
    });

    test('should return false when updating non-existent item', () => {
      const updated = cart.updateQuantity('product999', 5);

      expect(updated).toBe(false);
    });

    test('should throw error when quantity is less than 1', () => {
      cart.addItem('product1', 2, { name: 'Test', price: 100 });

      expect(() => cart.updateQuantity('product1', 0)).toThrow('Quantity must be at least 1');
      expect(() => cart.updateQuantity('product1', -1)).toThrow('Quantity must be at least 1');
    });

    test('should throw error when productId is missing', () => {
      expect(() => cart.updateQuantity('', 5)).toThrow('Product ID is required');
      expect(() => cart.updateQuantity(null, 5)).toThrow('Product ID is required');
    });
  });

  describe('getItems', () => {
    test('should return empty array for new cart', () => {
      expect(cart.getItems()).toEqual([]);
    });

    test('should return all items in cart', () => {
      cart.addItem('product1', 1, { name: 'Test 1', price: 100 });
      cart.addItem('product2', 2, { name: 'Test 2', price: 200 });

      const items = cart.getItems();

      expect(items).toHaveLength(2);
      expect(items[0].productId).toBe('product1');
      expect(items[1].productId).toBe('product2');
    });

    test('should return a copy of items array', () => {
      cart.addItem('product1', 1, { name: 'Test', price: 100 });

      const items = cart.getItems();
      items.push({ productId: 'fake', quantity: 1 });

      // Original cart should not be modified
      expect(cart.getItems()).toHaveLength(1);
    });
  });

  describe('getTotalPrice', () => {
    test('should return 0 for empty cart', () => {
      expect(cart.getTotalPrice()).toBe(0);
    });

    test('should calculate total price for single item', () => {
      cart.addItem('product1', 3, { name: 'Test', price: 100 });

      expect(cart.getTotalPrice()).toBe(300);
    });

    test('should calculate total price for multiple items', () => {
      cart.addItem('product1', 2, { name: 'Test 1', price: 100 });
      cart.addItem('product2', 3, { name: 'Test 2', price: 200 });
      cart.addItem('product3', 1, { name: 'Test 3', price: 50 });

      // (2 * 100) + (3 * 200) + (1 * 50) = 200 + 600 + 50 = 850
      expect(cart.getTotalPrice()).toBe(850);
    });

    test('should update total after removing item', () => {
      cart.addItem('product1', 2, { name: 'Test 1', price: 100 });
      cart.addItem('product2', 3, { name: 'Test 2', price: 200 });

      cart.removeItem('product1');

      expect(cart.getTotalPrice()).toBe(600);
    });

    test('should update total after updating quantity', () => {
      cart.addItem('product1', 2, { name: 'Test', price: 100 });

      cart.updateQuantity('product1', 5);

      expect(cart.getTotalPrice()).toBe(500);
    });
  });

  describe('clear', () => {
    test('should remove all items from cart', () => {
      cart.addItem('product1', 1, { name: 'Test 1', price: 100 });
      cart.addItem('product2', 2, { name: 'Test 2', price: 200 });

      cart.clear();

      expect(cart.getItems()).toHaveLength(0);
      expect(cart.getTotalPrice()).toBe(0);
    });

    test('should work on empty cart', () => {
      cart.clear();

      expect(cart.getItems()).toHaveLength(0);
    });
  });

  describe('saveToStorage and loadFromStorage', () => {
    test('should save cart to localStorage', () => {
      cart.addItem('product1', 2, { name: 'Test', price: 100, seller: 'Seller 1' });

      cart.saveToStorage();

      const stored = localStorage.getItem('marketplace_cart');
      expect(stored).toBeTruthy();
      
      const parsed = JSON.parse(stored);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].productId).toBe('product1');
    });

    test('should load cart from localStorage', () => {
      const testData = [
        { productId: 'product1', quantity: 2, name: 'Test', price: 100 },
        { productId: 'product2', quantity: 1, name: 'Test 2', price: 200 }
      ];
      
      localStorage.setItem('marketplace_cart', JSON.stringify(testData));

      cart.loadFromStorage();

      expect(cart.getItems()).toHaveLength(2);
      expect(cart.getItems()[0].productId).toBe('product1');
      expect(cart.getItems()[1].productId).toBe('product2');
    });

    test('should handle missing localStorage data', () => {
      cart.loadFromStorage();

      expect(cart.getItems()).toEqual([]);
    });

    test('should handle invalid JSON in localStorage', () => {
      localStorage.setItem('marketplace_cart', 'invalid json');

      cart.loadFromStorage();

      expect(cart.getItems()).toEqual([]);
    });

    test('should preserve cart state through save/load cycle', () => {
      cart.addItem('product1', 2, { name: 'Test 1', price: 100 });
      cart.addItem('product2', 3, { name: 'Test 2', price: 200 });

      cart.saveToStorage();

      const newCart = new ShoppingCart();
      newCart.loadFromStorage();

      expect(newCart.getItems()).toHaveLength(2);
      expect(newCart.getTotalPrice()).toBe(cart.getTotalPrice());
    });
  });

  describe('getItemCount', () => {
    test('should return 0 for empty cart', () => {
      expect(cart.getItemCount()).toBe(0);
    });

    test('should return total count of all items', () => {
      cart.addItem('product1', 2, { name: 'Test 1', price: 100 });
      cart.addItem('product2', 3, { name: 'Test 2', price: 200 });
      cart.addItem('product3', 1, { name: 'Test 3', price: 50 });

      expect(cart.getItemCount()).toBe(6); // 2 + 3 + 1
    });

    test('should update count after adding items', () => {
      cart.addItem('product1', 2, { name: 'Test', price: 100 });
      expect(cart.getItemCount()).toBe(2);

      cart.addItem('product1', 3, { name: 'Test', price: 100 });
      expect(cart.getItemCount()).toBe(5);
    });

    test('should update count after removing items', () => {
      cart.addItem('product1', 2, { name: 'Test 1', price: 100 });
      cart.addItem('product2', 3, { name: 'Test 2', price: 200 });

      cart.removeItem('product1');

      expect(cart.getItemCount()).toBe(3);
    });
  });
});
