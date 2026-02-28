/**
 * CartUI class handles rendering of shopping cart interface
 * 
 * Responsibilities:
 * - Display cart items with details
 * - Show grand total
 * - Render remove buttons
 * - Show checkout button conditionally
 * - Display empty cart message
 * 
 * Requirements: 2.6, 7.1, 7.2, 7.3, 7.6, 7.7
 */
class CartUI {
  constructor(cart, containerId) {
    this.cart = cart;
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container element with id "${containerId}" not found`);
    }
  }

  /**
   * Escape HTML special characters
   */
  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Escape special characters for use in CSS selectors
   */
  escapeCSS(str) {
    return str.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~\s]/g, '\\$&');
  }

  /**
   * Render the complete cart UI
   * 
   * @param {Function} onRemove - Callback when remove button is clicked
   * @param {Function} onCheckout - Callback when checkout button is clicked
   * 
   * Validates: Requirements 2.6, 7.1, 7.2, 7.3, 7.6, 7.7
   */
  render(onRemove, onCheckout) {
    const items = this.cart.getItems();
    
    if (items.length === 0) {
      this.renderEmptyCart();
      return;
    }

    this.renderCartWithItems(items, onRemove, onCheckout);
  }

  /**
   * Render empty cart message
   * 
   * Validates: Requirement 7.7
   */
  renderEmptyCart() {
    this.container.innerHTML = `
      <div class="empty-cart-message">
        <p>Your cart is empty</p>
        <p class="empty-cart-subtitle">Add some products to get started!</p>
      </div>
    `;
  }

  /**
   * Render cart with items
   * 
   * Validates: Requirements 2.6, 7.1, 7.2, 7.3, 7.6
   */
  renderCartWithItems(items, onRemove, onCheckout) {
    const itemsHTML = items.map(item => this.renderCartItem(item)).join('');
    const totalPrice = this.cart.getTotalPrice();
    const itemCount = this.cart.getItemCount();

    this.container.innerHTML = `
      <div class="cart-items-list">
        ${itemsHTML}
      </div>
      <div class="cart-summary">
        <div class="cart-summary-row">
          <span>Total Items:</span>
          <span>${itemCount}</span>
        </div>
        <div class="cart-summary-row cart-total">
          <span>Grand Total:</span>
          <span>₹${totalPrice.toFixed(2)}</span>
        </div>
        <button class="checkout-button" id="checkoutButton">
          Proceed to Checkout
        </button>
      </div>
    `;

    // Attach event listeners
    items.forEach(item => {
      const htmlEscapedProductId = this.escapeHTML(item.productId);
      // Find button by data attribute
      const removeButtons = this.container.querySelectorAll('.remove-button');
      const removeBtn = Array.from(removeButtons).find(btn => 
        btn.getAttribute('data-product-id') === htmlEscapedProductId
      );
      if (removeBtn && onRemove) {
        removeBtn.addEventListener('click', () => onRemove(item.productId));
      }
    });

    const checkoutBtn = document.getElementById('checkoutButton');
    if (checkoutBtn && onCheckout) {
      checkoutBtn.addEventListener('click', onCheckout);
    }
  }

  /**
   * Render a single cart item
   * 
   * Validates: Requirements 2.6, 7.1, 7.2
   */
  renderCartItem(item) {
    const lineTotal = item.price * item.quantity;
    // Escape productId for use in CSS selector and HTML attribute
    const escapedProductId = this.escapeCSS(item.productId);
    const htmlEscapedProductId = this.escapeHTML(item.productId);
    const htmlEscapedName = this.escapeHTML(item.name);
    const htmlEscapedSeller = this.escapeHTML(item.seller);
    
    return `
      <div class="cart-item" data-product-id="${htmlEscapedProductId}">
        <div class="cart-item-details">
          <div class="cart-item-name">${htmlEscapedName}</div>
          <div class="cart-item-seller">Seller: ${htmlEscapedSeller}</div>
          <div class="cart-item-pricing">
            <span class="cart-item-unit-price">₹${item.price} × ${item.quantity} ${item.unit}</span>
            <span class="cart-item-line-total">= ₹${lineTotal.toFixed(2)}</span>
          </div>
        </div>
        <div class="cart-item-actions">
          <button class="remove-button" data-product-id="${htmlEscapedProductId}">
            Remove
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Update cart badge count in header
   * 
   * @param {string} badgeId - ID of the badge element
   * 
   * Validates: Requirement 2.4
   */
  updateBadge(badgeId) {
    const badge = document.getElementById(badgeId);
    if (badge) {
      badge.textContent = this.cart.getItemCount();
    }
  }
}

// Export for use in Node.js (testing) and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CartUI;
}
