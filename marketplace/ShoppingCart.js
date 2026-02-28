/**
 * ShoppingCart class manages cart state and operations for the marketplace buyer interface.
 * 
 * Responsibilities:
 * - Add items to cart with specified quantities
 * - Remove items from cart
 * - Update item quantities
 * - Calculate total price
 * - Persist cart state to localStorage
 * 
 * Requirements: 2.2, 2.8, 7.4, 7.5
 */
class ShoppingCart {
  constructor() {
    this.items = [];
  }

  /**
   * Add an item to the cart with specified quantity
   * If item already exists, increment the quantity
   * 
   * @param {string} productId - The unique identifier of the product
   * @param {number} quantity - The quantity to add
   * @param {Object} productDetails - Additional product details (name, price, seller, unit)
   * @returns {void}
   * 
   * Validates: Requirements 2.2, 3.5, 3.6
   */
  addItem(productId, quantity, productDetails = {}) {
    if (!productId) {
      throw new Error('Product ID is required');
    }
    
    if (!quantity || quantity < 1) {
      throw new Error('Quantity must be at least 1');
    }

    const existingItem = this.items.find(item => item.productId === productId);
    
    if (existingItem) {
      // Increment existing quantity (Requirement 3.6)
      existingItem.quantity += quantity;
    } else {
      // Add new item to cart
      this.items.push({
        productId,
        quantity,
        name: productDetails.name || '',
        price: productDetails.price || 0,
        seller: productDetails.seller || '',
        unit: productDetails.unit || 'piece'
      });
    }
  }

  /**
   * Remove an item from the cart
   * 
   * @param {string} productId - The unique identifier of the product to remove
   * @returns {boolean} - True if item was removed, false if not found
   * 
   * Validates: Requirements 2.8, 7.5
   */
  removeItem(productId) {
    if (!productId) {
      throw new Error('Product ID is required');
    }

    const initialLength = this.items.length;
    this.items = this.items.filter(item => item.productId !== productId);
    
    return this.items.length < initialLength;
  }

  /**
   * Update the quantity of an item in the cart
   * 
   * @param {string} productId - The unique identifier of the product
   * @param {number} quantity - The new quantity (must be >= 1)
   * @returns {boolean} - True if updated, false if item not found
   * 
   * Validates: Requirements 3.3, 3.4
   */
  updateQuantity(productId, quantity) {
    if (!productId) {
      throw new Error('Product ID is required');
    }

    if (!quantity || quantity < 1) {
      throw new Error('Quantity must be at least 1');
    }

    const item = this.items.find(item => item.productId === productId);
    
    if (item) {
      item.quantity = quantity;
      return true;
    }
    
    return false;
  }

  /**
   * Get all items in the cart
   * 
   * @returns {Array} - Array of cart items
   * 
   * Validates: Requirements 2.6, 7.1
   */
  getItems() {
    return [...this.items]; // Return a copy to prevent external modification
  }

  /**
   * Calculate the total price of all items in the cart
   * 
   * @returns {number} - Total price (sum of quantity × price for all items)
   * 
   * Validates: Requirements 2.7, 7.3
   */
  getTotalPrice() {
    return this.items.reduce((total, item) => {
      return total + (item.price * item.quantity);
    }, 0);
  }

  /**
   * Clear all items from the cart
   * 
   * @returns {void}
   * 
   * Validates: Requirements 6.6
   */
  clear() {
    this.items = [];
  }

  /**
   * Save cart state to localStorage
   * 
   * @returns {void}
   * 
   * Validates: Requirements 2.9
   */
  saveToStorage() {
    try {
      localStorage.setItem('marketplace_cart', JSON.stringify(this.items));
    } catch (error) {
      // Handle localStorage quota exceeded or unavailable
      console.error('Failed to save cart to localStorage:', error);
      throw new Error('Unable to save cart. Storage may be full or unavailable.');
    }
  }

  /**
   * Load cart state from localStorage
   * 
   * @returns {void}
   * 
   * Validates: Requirements 2.9
   */
  loadFromStorage() {
    try {
      const stored = localStorage.getItem('marketplace_cart');
      if (stored) {
        this.items = JSON.parse(stored);
      }
    } catch (error) {
      // Handle invalid JSON or localStorage unavailable
      console.error('Failed to load cart from localStorage:', error);
      this.items = [];
    }
  }

  /**
   * Get the total number of items in the cart
   * 
   * @returns {number} - Total count of all items
   * 
   * Validates: Requirements 2.4
   */
  getItemCount() {
    return this.items.reduce((count, item) => count + item.quantity, 0);
  }
}

// Export for use in Node.js (testing) and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ShoppingCart;
}
