/**
 * Property-based tests for ShoppingCart class
 * 
 * Tests universal properties that should hold across all inputs:
 * - Property 4: Add to Cart Operation
 * - Property 7: Cart Total Calculation
 * - Property 8: Remove from Cart Operation
 * 
 * Uses fast-check for property-based testing with minimum 100 iterations per property
 * 
 * Requirements: 2.2, 2.7, 2.8, 7.3, 7.5
 */

const fc = require('fast-check');
const ShoppingCart = require('../../marketplace/ShoppingCart');

// Arbitraries (generators) for test data

/**
 * Generate valid product IDs
 */
const productIdArbitrary = () => fc.string({ minLength: 1, maxLength: 50 });

/**
 * Generate valid quantities (positive integers)
 */
const quantityArbitrary = () => fc.integer({ min: 1, max: 1000 });

/**
 * Generate valid prices (positive numbers)
 */
const priceArbitrary = () => fc.integer({ min: 1, max: 100000 });

/**
 * Generate product details
 */
const productDetailsArbitrary = () => fc.record({
  name: fc.string({ minLength: 1, maxLength: 100 }),
  price: priceArbitrary(),
  seller: fc.string({ minLength: 1, maxLength: 50 }),
  unit: fc.constantFrom('kg', 'piece', 'liter', 'dozen', 'gram', 'box')
});

/**
 * Generate a cart item (productId + quantity + details)
 */
const cartItemArbitrary = () => fc.record({
  productId: productIdArbitrary(),
  quantity: quantityArbitrary(),
  details: productDetailsArbitrary()
});

describe('ShoppingCart Property-Based Tests', () => {
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

  /**
   * Property 4: Add to Cart Operation
   * 
   * **Validates: Requirements 2.2**
   * 
   * For any product and valid quantity, adding the product to the cart must result 
   * in that product appearing in the cart with the specified quantity.
   */
  test('Property 4: Add to Cart Operation', () => {
    fc.assert(
      fc.property(
        productIdArbitrary(),
        quantityArbitrary(),
        productDetailsArbitrary(),
        (productId, quantity, details) => {
          const cart = new ShoppingCart();
          
          // Add item to cart
          cart.addItem(productId, quantity, details);
          
          // Verify item appears in cart
          const items = cart.getItems();
          const addedItem = items.find(item => item.productId === productId);
          
          // Property: Item must exist in cart with correct quantity
          expect(addedItem).toBeDefined();
          expect(addedItem.quantity).toBe(quantity);
          expect(addedItem.productId).toBe(productId);
          expect(addedItem.name).toBe(details.name);
          expect(addedItem.price).toBe(details.price);
          expect(addedItem.seller).toBe(details.seller);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7: Cart Total Calculation
   * 
   * **Validates: Requirements 2.7, 7.3**
   * 
   * For any shopping cart contents, the calculated total price must equal 
   * the sum of all individual item line totals (quantity × unit price).
   */
  test('Property 7: Cart Total Calculation', () => {
    fc.assert(
      fc.property(
        fc.array(cartItemArbitrary(), { minLength: 0, maxLength: 20 }),
        (items) => {
          const cart = new ShoppingCart();
          
          // Add all items to cart
          items.forEach(item => {
            cart.addItem(item.productId, item.quantity, item.details);
          });
          
          // Calculate expected total manually
          const expectedTotal = items.reduce((sum, item) => {
            return sum + (item.details.price * item.quantity);
          }, 0);
          
          // Property: Cart total must equal sum of (quantity × price) for all items
          const actualTotal = cart.getTotalPrice();
          expect(actualTotal).toBe(expectedTotal);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 8: Remove from Cart Operation
   * 
   * **Validates: Requirements 2.8, 7.5**
   * 
   * For any item in the shopping cart, removing that item must result in it 
   * no longer appearing in the cart and the total being recalculated correctly.
   */
  test('Property 8: Remove from Cart Operation', () => {
    fc.assert(
      fc.property(
        fc.array(cartItemArbitrary(), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 0, max: 19 }), // Index of item to remove
        (items, removeIndex) => {
          // Skip if removeIndex is out of bounds
          if (removeIndex >= items.length) {
            return true;
          }

          const cart = new ShoppingCart();
          
          // Add all items to cart
          items.forEach(item => {
            cart.addItem(item.productId, item.quantity, item.details);
          });
          
          // Get the item to remove
          const itemToRemove = items[removeIndex];
          const totalBeforeRemove = cart.getTotalPrice();
          
          // Remove the item
          const removed = cart.removeItem(itemToRemove.productId);
          
          // Property 1: Remove operation should succeed
          expect(removed).toBe(true);
          
          // Property 2: Item should no longer be in cart
          const remainingItems = cart.getItems();
          const removedItem = remainingItems.find(item => item.productId === itemToRemove.productId);
          expect(removedItem).toBeUndefined();
          
          // Property 3: Total should be recalculated correctly
          const expectedTotal = totalBeforeRemove - (itemToRemove.details.price * itemToRemove.quantity);
          const actualTotal = cart.getTotalPrice();
          expect(actualTotal).toBe(expectedTotal);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Cart operations maintain consistency
   * 
   * Verifies that multiple add and remove operations maintain cart consistency
   */
  test('Property: Cart operations maintain consistency', () => {
    fc.assert(
      fc.property(
        fc.array(cartItemArbitrary(), { minLength: 1, maxLength: 10 }),
        (items) => {
          const cart = new ShoppingCart();
          
          // Add all items
          items.forEach(item => {
            cart.addItem(item.productId, item.quantity, item.details);
          });
          
          const itemCount = cart.getItems().length;
          const totalPrice = cart.getTotalPrice();
          
          // Property: Item count should match number of unique products
          const uniqueProductIds = new Set(items.map(item => item.productId));
          expect(itemCount).toBe(uniqueProductIds.size);
          
          // Property: Total price should be non-negative
          expect(totalPrice).toBeGreaterThanOrEqual(0);
          
          // Property: Each item in cart should have positive quantity
          cart.getItems().forEach(item => {
            expect(item.quantity).toBeGreaterThan(0);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Adding same product multiple times increments quantity
   * 
   * **Validates: Requirements 3.6**
   */
  test('Property: Adding same product multiple times increments quantity', () => {
    fc.assert(
      fc.property(
        productIdArbitrary(),
        fc.array(quantityArbitrary(), { minLength: 1, maxLength: 10 }),
        productDetailsArbitrary(),
        (productId, quantities, details) => {
          const cart = new ShoppingCart();
          
          // Add same product multiple times with different quantities
          quantities.forEach(qty => {
            cart.addItem(productId, qty, details);
          });
          
          // Property: Should have only one item in cart
          const items = cart.getItems();
          expect(items).toHaveLength(1);
          
          // Property: Quantity should be sum of all additions
          const expectedQuantity = quantities.reduce((sum, qty) => sum + qty, 0);
          expect(items[0].quantity).toBe(expectedQuantity);
          
          // Property: Total price should reflect accumulated quantity
          const expectedTotal = details.price * expectedQuantity;
          expect(cart.getTotalPrice()).toBe(expectedTotal);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Removing non-existent item doesn't affect cart
   */
  test('Property: Removing non-existent item does not affect cart', () => {
    fc.assert(
      fc.property(
        fc.array(cartItemArbitrary(), { minLength: 1, maxLength: 10 }),
        productIdArbitrary(),
        (items, nonExistentId) => {
          const cart = new ShoppingCart();
          
          // Add items to cart
          items.forEach(item => {
            cart.addItem(item.productId, item.quantity, item.details);
          });
          
          // Ensure nonExistentId is not in cart
          const existingIds = items.map(item => item.productId);
          if (existingIds.includes(nonExistentId)) {
            return true; // Skip this test case
          }
          
          const itemsBefore = cart.getItems().length;
          const totalBefore = cart.getTotalPrice();
          
          // Try to remove non-existent item
          const removed = cart.removeItem(nonExistentId);
          
          // Property: Remove should return false
          expect(removed).toBe(false);
          
          // Property: Cart should remain unchanged
          expect(cart.getItems()).toHaveLength(itemsBefore);
          expect(cart.getTotalPrice()).toBe(totalBefore);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Clear operation empties cart completely
   * 
   * **Validates: Requirements 6.6**
   */
  test('Property: Clear operation empties cart completely', () => {
    fc.assert(
      fc.property(
        fc.array(cartItemArbitrary(), { minLength: 0, maxLength: 20 }),
        (items) => {
          const cart = new ShoppingCart();
          
          // Add items to cart
          items.forEach(item => {
            cart.addItem(item.productId, item.quantity, item.details);
          });
          
          // Clear cart
          cart.clear();
          
          // Property: Cart should be empty
          expect(cart.getItems()).toHaveLength(0);
          expect(cart.getTotalPrice()).toBe(0);
          expect(cart.getItemCount()).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
