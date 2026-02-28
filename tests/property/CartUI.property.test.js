/**
 * Property-based tests for CartUI class
 * 
 * Tests universal properties for cart display:
 * - Property 5: Cart Item Count Display
 * - Property 6: Cart Item Display Completeness
 * - Property 23: Checkout Button Conditional Display
 * 
 * Requirements: 2.4, 2.6, 7.1, 7.2, 7.6
 * 
 * @jest-environment jsdom
 */

const fc = require('fast-check');
const ShoppingCart = require('../../marketplace/ShoppingCart');
const CartUI = require('../../marketplace/CartUI');

// Arbitraries
const productIdArbitrary = () => fc.string({ minLength: 1, maxLength: 50 });
const quantityArbitrary = () => fc.integer({ min: 1, max: 1000 });
const priceArbitrary = () => fc.integer({ min: 1, max: 100000 });

const productDetailsArbitrary = () => fc.record({
  name: fc.string({ minLength: 1, maxLength: 100 }),
  price: priceArbitrary(),
  seller: fc.string({ minLength: 1, maxLength: 50 }),
  unit: fc.constantFrom('kg', 'piece', 'liter', 'dozen')
});

const cartItemArbitrary = () => fc.record({
  productId: productIdArbitrary(),
  quantity: quantityArbitrary(),
  details: productDetailsArbitrary()
});

// Helper function to escape CSS selectors (same as CartUI)
function escapeCSS(str) {
  return str.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~\s]/g, '\\$&');
}

// Helper function to escape HTML (same as CartUI)
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

describe('CartUI Property-Based Tests', () => {
  let container;

  beforeEach(() => {
    // Create container in the DOM
    document.body.innerHTML = '<div id="cart-container"></div><span id="cart-badge">0</span>';
    container = document.getElementById('cart-container');
  });

  /**
   * Property 5: Cart Item Count Display
   * 
   * **Validates: Requirements 2.4**
   * 
   * For any cart state, the cart badge must display a count equal to 
   * the total number of items in the cart.
   */
  test('Property 5: Cart Item Count Display', () => {
    fc.assert(
      fc.property(
        fc.array(cartItemArbitrary(), { minLength: 0, maxLength: 20 }),
        (items) => {
          const cart = new ShoppingCart();
          const cartUI = new CartUI(cart, 'cart-container');

          // Add items to cart
          items.forEach(item => {
            cart.addItem(item.productId, item.quantity, item.details);
          });

          // Update badge
          cartUI.updateBadge('cart-badge');

          // Calculate expected count
          const expectedCount = items.reduce((sum, item) => sum + item.quantity, 0);

          // Property: Badge should display total item count
          const badge = document.getElementById('cart-badge');
          expect(parseInt(badge.textContent)).toBe(expectedCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Cart Item Display Completeness
   * 
   * **Validates: Requirements 2.6, 7.1, 7.2**
   * 
   * For any item in the shopping cart, the rendered display must include 
   * the item's name, quantity, unit price, line total, and seller name.
   */
  test('Property 6: Cart Item Display Completeness', () => {
    fc.assert(
      fc.property(
        fc.array(cartItemArbitrary(), { minLength: 1, maxLength: 10 }),
        (items) => {
          const cart = new ShoppingCart();
          const cartUI = new CartUI(cart, 'cart-container');

          // Ensure items with same productId have same details (realistic constraint)
          const itemMap = new Map();
          items.forEach(item => {
            if (!itemMap.has(item.productId)) {
              itemMap.set(item.productId, item.details);
            }
          });

          // Add items to cart with consistent details
          items.forEach(item => {
            const details = itemMap.get(item.productId);
            cart.addItem(item.productId, item.quantity, details);
          });

          // Render cart
          cartUI.render(() => {}, () => {});

          // Get actual items from cart (which may have merged duplicates)
          const actualItems = cart.getItems();

          // Property 1: Number of rendered items matches cart items
          const renderedItems = container.querySelectorAll('.cart-item');
          expect(renderedItems.length).toBe(actualItems.length);

          // Property 2: Each rendered item has all required elements
          renderedItems.forEach(itemElement => {
            // Check for name element
            const nameElement = itemElement.querySelector('.cart-item-name');
            expect(nameElement).toBeTruthy();
            expect(nameElement.textContent.length).toBeGreaterThan(0);
            
            // Check for seller element
            const sellerElement = itemElement.querySelector('.cart-item-seller');
            expect(sellerElement).toBeTruthy();
            expect(sellerElement.textContent).toContain('Seller:');
            
            // Check for pricing element
            const pricingElement = itemElement.querySelector('.cart-item-pricing');
            expect(pricingElement).toBeTruthy();
            
            // Check for unit price
            const unitPriceElement = itemElement.querySelector('.cart-item-unit-price');
            expect(unitPriceElement).toBeTruthy();
            expect(unitPriceElement.textContent).toContain('₹');
            
            // Check for line total
            const lineTotalElement = itemElement.querySelector('.cart-item-line-total');
            expect(lineTotalElement).toBeTruthy();
            expect(lineTotalElement.textContent).toContain('₹');
            expect(lineTotalElement.textContent).toContain('=');
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 23: Checkout Button Conditional Display
   * 
   * **Validates: Requirements 7.6**
   * 
   * For any non-empty shopping cart, the rendered cart view must include 
   * a "Proceed to Checkout" button.
   */
  test('Property 23: Checkout Button Conditional Display - Non-empty cart', () => {
    fc.assert(
      fc.property(
        fc.array(cartItemArbitrary(), { minLength: 1, maxLength: 20 }),
        (items) => {
          const cart = new ShoppingCart();
          const cartUI = new CartUI(cart, 'cart-container');

          // Add items to cart
          items.forEach(item => {
            cart.addItem(item.productId, item.quantity, item.details);
          });

          // Render cart
          cartUI.render(() => {}, () => {});

          // Property: Checkout button must be present for non-empty cart
          const checkoutButton = container.querySelector('#checkoutButton');
          expect(checkoutButton).toBeTruthy();
          expect(checkoutButton.textContent).toContain('Proceed to Checkout');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 23: Checkout Button Conditional Display - Empty cart
   * 
   * **Validates: Requirements 7.7**
   * 
   * For an empty shopping cart, the checkout button should not be displayed.
   */
  test('Property 23: Checkout Button Conditional Display - Empty cart', () => {
    const cart = new ShoppingCart();
    const cartUI = new CartUI(cart, 'cart-container');

    // Render empty cart
    cartUI.render(() => {}, () => {});

    // Property: Checkout button must NOT be present for empty cart
    const checkoutButton = container.querySelector('#checkoutButton');
    expect(checkoutButton).toBeNull();

    // Property: Empty cart message should be displayed
    const emptyMessage = container.querySelector('.empty-cart-message');
    expect(emptyMessage).toBeTruthy();
  });

  /**
   * Additional property: Cart displays correct grand total
   */
  test('Property: Cart displays correct grand total', () => {
    fc.assert(
      fc.property(
        fc.array(cartItemArbitrary(), { minLength: 1, maxLength: 20 }),
        (items) => {
          const cart = new ShoppingCart();
          const cartUI = new CartUI(cart, 'cart-container');

          // Ensure items with same productId have same details (realistic constraint)
          const itemMap = new Map();
          items.forEach(item => {
            if (!itemMap.has(item.productId)) {
              itemMap.set(item.productId, item.details);
            }
          });

          // Add items to cart with consistent details
          items.forEach(item => {
            const details = itemMap.get(item.productId);
            cart.addItem(item.productId, item.quantity, details);
          });

          // Render cart
          cartUI.render(() => {}, () => {});

          // Calculate expected total from actual cart state
          const expectedTotal = cart.getTotalPrice();

          // Property: Displayed total must match calculated total
          const totalElement = container.querySelector('.cart-total');
          expect(totalElement).toBeTruthy();
          expect(totalElement.textContent).toContain(`₹${expectedTotal.toFixed(2)}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Remove button present for each item
   */
  test('Property: Remove button present for each cart item', () => {
    fc.assert(
      fc.property(
        fc.array(cartItemArbitrary(), { minLength: 1, maxLength: 10 }),
        (items) => {
          const cart = new ShoppingCart();
          const cartUI = new CartUI(cart, 'cart-container');

          // Ensure items with same productId have same details (realistic constraint)
          const itemMap = new Map();
          items.forEach(item => {
            if (!itemMap.has(item.productId)) {
              itemMap.set(item.productId, item.details);
            }
          });

          // Add items to cart with consistent details
          items.forEach(item => {
            const details = itemMap.get(item.productId);
            cart.addItem(item.productId, item.quantity, details);
          });

          // Render cart
          cartUI.render(() => {}, () => {});

          // Get actual items from cart (which may have merged duplicates)
          const actualItems = cart.getItems();

          // Property: Number of remove buttons matches number of cart items
          const removeButtons = container.querySelectorAll('button.remove-button');
          expect(removeButtons.length).toBe(actualItems.length);
          
          // Property: Each remove button has correct text
          removeButtons.forEach(button => {
            expect(button.tagName).toBe('BUTTON');
            expect(button.textContent.trim()).toContain('Remove');
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
