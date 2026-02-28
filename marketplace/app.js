/**
 * Marketplace Buyer Interface - Main Application
 * 
 * Integrates all components:
 * - BuyerAuth for login/session management
 * - ProductCatalog for browsing products
 * - ShoppingCart for cart management
 * - CartUI for cart display
 * - CheckoutFlow for order submission
 */

// API Configuration - will be replaced during deployment
const API_BASE_URL = window.API_BASE_URL || 'https://o72ecc4lpg.execute-api.us-east-1.amazonaws.com/prod/';

// Global state
let currentUser = null;
let cart = null;
let cartUI = null;
let productCatalog = null;

/**
 * Initialize the application
 */
async function initializeApp() {
  console.log('Initializing Marketplace Buyer Interface...');

  // Check for existing session
  currentUser = loadSession();

  if (!currentUser) {
    showLoginScreen();
  } else {
    showMarketplace();
  }
}

/**
 * Load session from localStorage
 */
function loadSession() {
  try {
    const session = localStorage.getItem('buyer_session');
    if (session) {
      return JSON.parse(session);
    }
  } catch (error) {
    console.error('Failed to load session:', error);
  }
  return null;
}

/**
 * Save session to localStorage
 */
function saveSession(user) {
  try {
    localStorage.setItem('buyer_session', JSON.stringify(user));
    currentUser = user;
  } catch (error) {
    console.error('Failed to save session:', error);
  }
}

/**
 * Clear session
 */
function clearSession() {
  localStorage.removeItem('buyer_session');
  currentUser = null;
}

/**
 * Show login screen
 */
function showLoginScreen() {
  document.body.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <h1>🛒 Vyapar Vaani Marketplace</h1>
        <p class="subtitle">Welcome! Please login to continue</p>
        
        <form id="loginForm" class="login-form">
          <div class="form-group">
            <label for="buyerName">Your Name</label>
            <input type="text" id="buyerName" required placeholder="Enter your name" />
          </div>
          
          <div class="form-group">
            <label for="buyerPhone">Phone Number</label>
            <input type="tel" id="buyerPhone" required placeholder="10-digit phone number" pattern="[0-9]{10,15}" />
          </div>
          
          <button type="submit" class="btn-primary">Login</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('loginForm').addEventListener('submit', handleLogin);
}

/**
 * Handle login form submission
 */
function handleLogin(e) {
  e.preventDefault();

  const name = document.getElementById('buyerName').value.trim();
  const phone = document.getElementById('buyerPhone').value.trim();

  // Validate
  if (!name || !phone) {
    alert('Please enter both name and phone number');
    return;
  }

  if (phone.length < 10) {
    alert('Phone number must be at least 10 digits');
    return;
  }

  // Save session
  saveSession({ name, phone });

  // Show marketplace
  showMarketplace();
}

/**
 * Show marketplace interface
 */
function showMarketplace() {
  document.body.innerHTML = `
    <div class="marketplace-container">
      <!-- Header -->
      <header class="marketplace-header">
        <div class="header-content">
          <h1>🛒 Vyapar Vaani Marketplace</h1>
          <div class="header-actions">
            <span class="user-name">Welcome, ${currentUser.name}!</span>
            <button id="cartButton" class="cart-button">
              🛒 Cart <span id="cartBadge" class="cart-badge">0</span>
            </button>
            <button id="logoutButton" class="btn-secondary">Logout</button>
          </div>
        </div>
      </header>

      <!-- Main Content -->
      <main class="marketplace-main">
        <!-- Search and Filter -->
        <div class="search-filter-bar">
          <input type="text" id="searchInput" placeholder="Search products..." class="search-input" />
          <select id="categoryFilter" class="category-filter">
            <option value="">All Categories</option>
            <option value="Vegetables">Vegetables</option>
            <option value="Fruits">Fruits</option>
            <option value="Grains">Grains</option>
            <option value="Dairy">Dairy</option>
            <option value="Grocery">Grocery</option>
          </select>
        </div>

        <!-- Products Grid -->
        <div id="productsContainer" class="products-grid">
          <div class="loading">Loading products...</div>
        </div>

        <!-- Cart Sidebar (hidden by default) -->
        <div id="cartSidebar" class="cart-sidebar hidden">
          <div class="cart-header">
            <h2>Your Cart</h2>
            <button id="closeCart" class="close-button">×</button>
          </div>
          <div id="cartContainer" class="cart-content"></div>
        </div>

        <!-- Checkout Modal (hidden by default) -->
        <div id="checkoutModal" class="modal hidden">
          <div class="modal-content">
            <div class="modal-header">
              <h2>Checkout</h2>
              <button id="closeCheckout" class="close-button">×</button>
            </div>
            <div id="checkoutContainer" class="modal-body"></div>
          </div>
        </div>
      </main>
    </div>
  `;

  // Initialize components
  initializeMarketplaceComponents();

  // Attach event listeners
  document.getElementById('cartButton').addEventListener('click', toggleCart);
  document.getElementById('closeCart').addEventListener('click', toggleCart);
  document.getElementById('logoutButton').addEventListener('click', handleLogout);
  document.getElementById('searchInput').addEventListener('input', handleSearch);
  document.getElementById('categoryFilter').addEventListener('change', handleCategoryFilter);
}

/**
 * Initialize marketplace components
 */
function initializeMarketplaceComponents() {
  // Check if ShoppingCart and CartUI are loaded
  if (typeof ShoppingCart === 'undefined') {
    console.error('ShoppingCart class not loaded');
    return;
  }
  if (typeof CartUI === 'undefined') {
    console.error('CartUI class not loaded');
    return;
  }

  // Initialize cart
  cart = new ShoppingCart();
  cart.loadFromStorage();

  // Initialize cart UI
  cartUI = new CartUI(cart, 'cartContainer');

  // Update badge
  updateCartBadge();

  // Load products
  loadProducts();

  // Set up polling for real-time updates (every 5 seconds)
  setInterval(loadProducts, 5000);
}

/**
 * Load products from API
 */
async function loadProducts() {
  try {
    const response = await fetch(`${API_BASE_URL}/products`);
    const data = await response.json();

    if (data.success && data.products) {
      renderProducts(data.products);
    }
  } catch (error) {
    console.error('Failed to load products:', error);
    document.getElementById('productsContainer').innerHTML = `
      <div class="error-message">
        Failed to load products. Please try again later.
      </div>
    `;
  }
}

/**
 * Render products grid
 */
function renderProducts(products) {
  const container = document.getElementById('productsContainer');

  if (products.length === 0) {
    container.innerHTML = '<div class="empty-message">No products available</div>';
    return;
  }

  container.innerHTML = products.map(product => `
    <div class="product-card" data-product-id="${product.productId}">
      <div class="product-image">
        ${product.imageUrl ? `<img src="${product.imageUrl}" alt="${product.name}" />` : '<div class="no-image">No Image</div>'}
      </div>
      <div class="product-details">
        <h3 class="product-name">${product.name}</h3>
        <p class="product-seller">Seller: ${product.seller.name}</p>
        <p class="product-price">₹${product.price} / ${product.unit}</p>
        <p class="product-quantity">Available: ${product.quantity} ${product.unit}</p>
        <div class="product-actions">
          <button class="btn-primary add-to-cart-btn" data-product='${JSON.stringify(product)}'>
            Add to Cart
          </button>
          <button class="btn-secondary buy-now-btn" data-product='${JSON.stringify(product)}'>
            Buy Now
          </button>
        </div>
      </div>
    </div>
  `).join('');

  // Attach event listeners
  document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
    btn.addEventListener('click', handleAddToCart);
  });

  document.querySelectorAll('.buy-now-btn').forEach(btn => {
    btn.addEventListener('click', handleBuyNow);
  });
}

/**
 * Handle add to cart
 */
function handleAddToCart(e) {
  const product = JSON.parse(e.target.dataset.product);

  cart.addItem(product.productId, 1, {
    name: product.name,
    price: product.price,
    seller: product.seller.name,
    unit: product.unit,
  });

  cart.saveToStorage();
  updateCartBadge();

  showToast(`${product.name} added to cart!`);
}

/**
 * Handle buy now
 */
function handleBuyNow(e) {
  const product = JSON.parse(e.target.dataset.product);

  // Clear cart and add single product
  cart.clear();
  cart.addItem(product.productId, 1, {
    name: product.name,
    price: product.price,
    seller: product.seller.name,
    unit: product.unit,
  });

  cart.saveToStorage();
  updateCartBadge();

  // Go directly to checkout
  showCheckout();
}

/**
 * Toggle cart sidebar
 */
function toggleCart() {
  const sidebar = document.getElementById('cartSidebar');
  sidebar.classList.toggle('hidden');

  if (!sidebar.classList.contains('hidden')) {
    renderCart();
  }
}

/**
 * Render cart
 */
function renderCart() {
  cartUI.render(handleRemoveFromCart, showCheckout);
  updateCartBadge();
}

/**
 * Handle remove from cart
 */
function handleRemoveFromCart(productId) {
  cart.removeItem(productId);
  cart.saveToStorage();
  renderCart();
  updateCartBadge();
  showToast('Item removed from cart');
}

/**
 * Update cart badge
 */
function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  if (badge) {
    badge.textContent = cart.getItemCount();
  }
}

/**
 * Show checkout modal
 */
function showCheckout() {
  const modal = document.getElementById('checkoutModal');
  const container = document.getElementById('checkoutContainer');

  // Hide cart sidebar
  document.getElementById('cartSidebar').classList.add('hidden');

  // Show checkout form
  container.innerHTML = `
    <div class="checkout-form">
      <h3>Delivery Address</h3>
      <form id="addressForm">
        <div class="form-group">
          <label>Name</label>
          <input type="text" id="addressName" value="${currentUser.name}" required />
        </div>
        <div class="form-group">
          <label>Phone</label>
          <input type="tel" id="addressPhone" value="${currentUser.phone}" required />
        </div>
        <div class="form-group">
          <label>Street Address</label>
          <input type="text" id="addressStreet" required />
        </div>
        <div class="form-group">
          <label>City</label>
          <input type="text" id="addressCity" required />
        </div>
        <div class="form-group">
          <label>State</label>
          <input type="text" id="addressState" required />
        </div>
        <div class="form-group">
          <label>Postal Code (6 digits)</label>
          <input type="text" id="addressPostalCode" pattern="[0-9]{6}" required />
        </div>
        
        <h3>Order Summary</h3>
        <div class="order-summary">
          ${cart.getItems().map(item => `
            <div class="summary-item">
              <span>${item.name} × ${item.quantity}</span>
              <span>₹${(item.price * item.quantity).toFixed(2)}</span>
            </div>
          `).join('')}
          <div class="summary-total">
            <strong>Total:</strong>
            <strong>₹${cart.getTotalPrice().toFixed(2)}</strong>
          </div>
        </div>
        
        <button type="submit" class="btn-primary btn-block">Confirm Order</button>
      </form>
    </div>
  `;

  modal.classList.remove('hidden');

  document.getElementById('addressForm').addEventListener('submit', handleSubmitOrder);
  document.getElementById('closeCheckout').addEventListener('click', () => {
    modal.classList.add('hidden');
  });
}

/**
 * Handle order submission
 */
async function handleSubmitOrder(e) {
  e.preventDefault();

  const orderData = {
    buyer: {
      name: document.getElementById('addressName').value,
      phone: document.getElementById('addressPhone').value,
      address: {
        name: document.getElementById('addressName').value,
        phone: document.getElementById('addressPhone').value,
        street: document.getElementById('addressStreet').value,
        city: document.getElementById('addressCity').value,
        state: document.getElementById('addressState').value,
        postalCode: document.getElementById('addressPostalCode').value,
      },
    },
    items: cart.getItems(),
    totalAmount: cart.getTotalPrice(),
  };

  try {
    showToast('Submitting order...', 'info');

    const response = await fetch(`${API_BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderData),
    });

    const result = await response.json();

    if (result.success) {
      // Clear cart
      cart.clear();
      cart.saveToStorage();
      updateCartBadge();

      // Close modal
      document.getElementById('checkoutModal').classList.add('hidden');

      // Show success message
      showToast('Order submitted successfully! Seller will contact you soon.', 'success');
    } else {
      showToast('Failed to submit order. Please try again.', 'error');
    }
  } catch (error) {
    console.error('Order submission failed:', error);
    showToast('Failed to submit order. Please try again.', 'error');
  }
}

/**
 * Handle search
 */
function handleSearch(e) {
  const searchTerm = e.target.value.toLowerCase();
  const productCards = document.querySelectorAll('.product-card');

  productCards.forEach(card => {
    const name = card.querySelector('.product-name').textContent.toLowerCase();
    if (name.includes(searchTerm)) {
      card.style.display = 'block';
    } else {
      card.style.display = 'none';
    }
  });
}

/**
 * Handle category filter
 */
function handleCategoryFilter(e) {
  const category = e.target.value;
  const productCards = document.querySelectorAll('.product-card');

  productCards.forEach(card => {
    if (!category) {
      card.style.display = 'block';
    } else {
      // Category would need to be added to product card data
      card.style.display = 'block';
    }
  });
}

/**
 * Handle logout
 */
function handleLogout() {
  if (confirm('Are you sure you want to logout?')) {
    clearSession();
    cart.clear();
    cart.saveToStorage();
    showLoginScreen();
  }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('show');
  }, 100);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

