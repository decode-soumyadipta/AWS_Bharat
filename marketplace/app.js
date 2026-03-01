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
let cachedProducts = []; // Cache to prevent flicker on re-render

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

        <!-- Order Tracking Modal (hidden by default) -->
        <div id="orderTrackingModal" class="modal hidden">
          <div class="modal-content">
            <div class="modal-header">
              <h2>Order Status</h2>
              <button onclick="document.getElementById('orderTrackingModal').classList.add('hidden')" class="close-button">×</button>
            </div>
            <div id="orderTrackingContainer" class="modal-body"></div>
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

  // Set up polling for real-time updates (every 10 seconds)
  // Uses smart diff to avoid image flickering
  setInterval(loadProducts, 10000);
}

/**
 * Load products from API
 */
async function loadProducts() {
  try {
    const response = await fetch(`${API_BASE_URL}/products`);
    const data = await response.json();

    if (data.success && data.products) {
      // Smart diff: only re-render if products actually changed
      const newIds = data.products.map(p => p.productId).sort().join(',');
      const oldIds = cachedProducts.map(p => p.productId).sort().join(',');
      const dataChanged = newIds !== oldIds || data.products.some((p, i) => {
        const cached = cachedProducts.find(c => c.productId === p.productId);
        return !cached || cached.price !== p.price || cached.quantity !== p.quantity || cached.name !== p.name;
      });

      if (dataChanged || cachedProducts.length === 0) {
        // Update image URLs in cache without full re-render if only URLs changed
        cachedProducts = data.products;
        renderProducts(data.products);
      } else {
        // Just update presigned image URLs in existing DOM (no flicker)
        data.products.forEach(p => {
          if (p.imageUrl) {
            const card = document.querySelector(`.product-card[data-product-id="${CSS.escape(p.productId)}"]`);
            if (card) {
              const img = card.querySelector('.product-image img');
              if (img && img.src !== p.imageUrl) {
                img.src = p.imageUrl;
              }
            }
          }
        });
        cachedProducts = data.products;
      }
    }
  } catch (error) {
    console.error('Failed to load products:', error);
    if (cachedProducts.length === 0) {
      document.getElementById('productsContainer').innerHTML = `
        <div class="error-message">
          Failed to load products. Please try again later.
        </div>
      `;
    }
  }
}

/**
 * Render products grid
 */
function renderProducts(products) {
  const container = document.getElementById('productsContainer');

  if (products.length === 0) {
    container.innerHTML = '<div class="empty-message">No products available yet. Products added via WhatsApp will appear here in real-time!</div>';
    return;
  }

  container.innerHTML = products.map(product => {
    // Generate presigned URL for S3 images or use direct URL
    const imageUrl = product.imageUrl || '';
    const displayImage = imageUrl ? `<img src="${imageUrl}" alt="${product.name}" onerror="this.parentElement.innerHTML='<div class=\\'no-image\\'>📦</div>'" />` : '<div class="no-image">📦</div>';
    
    // Truncate description to 60 characters
    const shortDesc = product.description ? (product.description.length > 60 ? product.description.substring(0, 60) + '...' : product.description) : '';

    // Quality badge
    const qs = product.qualityScore;
    const qualityBadge = qs && qs.badge ? {
      excellent: '<span class="quality-badge quality-excellent">⭐ Top Quality</span>',
      good: '<span class="quality-badge quality-good">✅ Good</span>',
      fair: '',
      needs_improvement: '',
    }[qs.badge] || '' : '';

    // UPI badge
    const upiBadge = product.seller && product.seller.upiId
      ? '<span class="upi-badge">💳 UPI</span>'
      : '';

    return `
    <div class="product-card" data-product-id="${product.productId}">
      <div class="product-image">
        ${displayImage}
        ${qualityBadge}
        ${upiBadge}
      </div>
      <div class="product-details">
        <h3 class="product-name">${product.name}</h3>
        ${shortDesc ? `<p class="product-description">${shortDesc}</p>` : ''}
        <p class="product-seller">👤 ${product.seller.name}</p>
        <div class="product-price-section">
          <span class="product-price">₹${product.price}</span>
          <span class="product-unit">/ ${product.unit}</span>
        </div>
        <p class="product-quantity">📦 Available: ${product.quantity} ${product.unit}</p>
        ${product.category ? `<span class="product-category">${product.category}</span>` : ''}
        <div class="product-actions">
          <button class="btn-primary add-to-cart-btn" data-product='${JSON.stringify(product).replace(/'/g, "&apos;")}'>
            🛒 Add to Cart
          </button>
          <button class="btn-buy-now buy-now-btn" data-product='${JSON.stringify(product).replace(/'/g, "&apos;")}'>
            ⚡ Buy Now
          </button>
        </div>
      </div>
    </div>
  `}).join('');

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
  const btn = e.target.closest('.add-to-cart-btn');
  if (!btn) return;
  const product = JSON.parse(btn.dataset.product);

  cart.addItem(product.productId, 1, {
    name: product.name,
    price: product.price,
    seller: product.seller, // Store full seller object {name, phone} for order submission
    unit: product.unit,
    imageUrl: product.imageUrl || '',
  });

  cart.saveToStorage();
  updateCartBadge();

  showToast(`${product.name} added to cart!`);
}

/**
 * Handle buy now
 */
function handleBuyNow(e) {
  const btn = e.target.closest('.buy-now-btn');
  if (!btn) return;
  const product = JSON.parse(btn.dataset.product);

  // Clear cart and add single product
  cart.clear();
  cart.addItem(product.productId, 1, {
    name: product.name,
    price: product.price,
    seller: product.seller, // Store full seller object {name, phone}
    unit: product.unit,
    imageUrl: product.imageUrl || '',
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
 * Show checkout modal with payment method selection
 */
function showCheckout() {
  const modal = document.getElementById('checkoutModal');
  const container = document.getElementById('checkoutContainer');

  // Hide cart sidebar
  const cartSidebar = document.getElementById('cartSidebar');
  if (cartSidebar) cartSidebar.classList.add('hidden');

  // Check if any seller has UPI enabled — check both cart items AND fresh product data
  const items = cart.getItems();
  let hasUpiSeller = items.some(item => item.seller && item.seller.upiId);

  // Also check cachedProducts in case cart items have stale seller data
  if (!hasUpiSeller && cachedProducts.length > 0) {
    hasUpiSeller = items.some(cartItem => {
      const freshProduct = cachedProducts.find(p => p.productId === cartItem.productId);
      if (freshProduct && freshProduct.seller && freshProduct.seller.upiId) {
        // Update cart item's seller data with fresh UPI info
        cartItem.seller = freshProduct.seller;
        return true;
      }
      return false;
    });
    if (hasUpiSeller) cart.saveToStorage(); // Persist the updated seller data
  }

  container.innerHTML = `
    <div class="checkout-form">
      <h3>📍 Delivery Address</h3>
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
        <div class="form-row">
          <div class="form-group">
            <label>City</label>
            <input type="text" id="addressCity" required />
          </div>
          <div class="form-group">
            <label>State</label>
            <input type="text" id="addressState" required />
          </div>
          <div class="form-group">
            <label>PIN Code</label>
            <input type="text" id="addressPostalCode" pattern="[0-9]{6}" required />
          </div>
        </div>

        <h3>💳 Payment Method</h3>
        <div class="payment-methods">
          ${hasUpiSeller ? `
          <label class="payment-option">
            <input type="radio" name="paymentMethod" value="UPI" checked />
            <div class="payment-card">
              <span class="payment-icon">📱</span>
              <div>
                <strong>UPI Payment</strong>
                <small>GPay, PhonePe, Paytm — Instant & Secure</small>
              </div>
            </div>
          </label>
          ` : ''}
          <label class="payment-option">
            <input type="radio" name="paymentMethod" value="COD" ${!hasUpiSeller ? 'checked' : ''} />
            <div class="payment-card">
              <span class="payment-icon">🏠</span>
              <div>
                <strong>Cash on Delivery</strong>
                <small>Pay when you receive the product</small>
              </div>
            </div>
          </label>
        </div>

        <h3>🛒 Order Summary</h3>
        <div class="order-summary">
          ${items.map(item => `
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

        <button type="submit" class="btn-primary btn-block">Place Order</button>
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
 * Handle order submission with payment flow
 */
async function handleSubmitOrder(e) {
  e.preventDefault();

  const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'COD';

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
    paymentMethod,
  };

  try {
    showToast('Placing order...', 'info');

    const response = await fetch(`${API_BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData),
    });

    const result = await response.json();

    if (result.success || response.status === 207) {
      // Clear cart
      cart.clear();
      cart.saveToStorage();
      updateCartBadge();

      if (paymentMethod === 'UPI') {
        // Show UPI payment screen
        showUpiPaymentScreen(result.orderId, orderData.totalAmount, orderData.items);
      } else {
        // COD — show success
        document.getElementById('checkoutModal').classList.add('hidden');
        showOrderConfirmation(result.orderId, 'COD');
      }
    } else {
      showToast('Failed to submit order. Please try again.', 'error');
    }
  } catch (error) {
    console.error('Order submission failed:', error);
    showToast('Failed to submit order. Please try again.', 'error');
  }
}

/**
 * Show UPI payment screen with QR code + deep link
 */
function showUpiPaymentScreen(orderId, totalAmount, items) {
  const container = document.getElementById('checkoutContainer');

  // Collect UPI IDs from cart items
  const sellerUpiMap = {};
  items.forEach(item => {
    if (item.seller && item.seller.upiId) {
      const phone = item.seller.phone;
      if (!sellerUpiMap[phone]) {
        sellerUpiMap[phone] = {
          upiId: item.seller.upiId,
          name: item.seller.name,
          amount: 0,
        };
      }
      sellerUpiMap[phone].amount += item.price * item.quantity;
    }
  });

  const sellers = Object.values(sellerUpiMap);
  const primarySeller = sellers[0] || { upiId: '', name: 'Seller', amount: totalAmount };

  // Build UPI deep link
  const upiLink = `upi://pay?pa=${encodeURIComponent(primarySeller.upiId)}&pn=${encodeURIComponent(primarySeller.name)}&am=${primarySeller.amount.toFixed(2)}&cu=INR&tn=Order+${orderId}`;

  container.innerHTML = `
    <div class="upi-payment-screen">
      <h3>📱 UPI Payment</h3>
      <p class="upi-amount">Pay <strong>₹${totalAmount.toFixed(2)}</strong></p>
      <p class="upi-to">to <strong>${primarySeller.name}</strong></p>

      <div class="upi-qr-container">
        <img id="upiQrImage" 
             src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiLink)}&format=png&margin=10" 
             alt="UPI QR Code" 
             width="220" height="220" 
             style="border-radius:12px;" 
             onerror="this.style.display='none'; document.getElementById('qrFallback').style.display='block';" />
        <canvas id="upiQrCode" style="display:none;"></canvas>
        <div id="qrFallback" style="display:none; padding:20px; text-align:center; color:#999;">
          <p>QR could not load. Use the button below to pay.</p>
        </div>
        <p class="upi-id-display">${primarySeller.upiId}</p>
        <p style="font-size:0.8rem; color:#888; margin-top:4px;">Scan with any UPI app (GPay, PhonePe, Paytm)</p>
      </div>

      <a href="${upiLink}" class="btn-upi-deep-link">
        📱 Open UPI App to Pay
      </a>

      <div class="upi-divider"><span>After payment</span></div>

      <div class="payment-verify-options">
        <button onclick="showManualRefInput('${orderId}')" class="btn-secondary">
          ✏️ Enter Transaction Ref
        </button>
        <button onclick="showScreenshotUpload('${orderId}')" class="btn-secondary">
          📸 Upload Screenshot
        </button>
      </div>

      <div id="paymentVerifyArea"></div>

      <button onclick="skipPaymentVerification('${orderId}')" class="btn-text">
        Skip for now (seller will verify)
      </button>
    </div>
  `;

  // Also try canvas QR as backup (if library loaded correctly)
  try {
    if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
      QRCode.toCanvas(document.getElementById('upiQrCode'), upiLink, {
        width: 220,
        margin: 2,
        color: { dark: '#000', light: '#fff' },
      }, function(err) {
        if (!err) {
          // Canvas worked — optionally swap to canvas if img failed
          console.log('QR canvas generated successfully');
        }
      });
    }
  } catch (e) {
    console.warn('QR canvas generation failed:', e);
  }
}

/**
 * Show manual transaction reference input
 */
function showManualRefInput(orderId) {
  const area = document.getElementById('paymentVerifyArea');
  area.innerHTML = `
    <div class="verify-form">
      <input type="text" id="transactionRef" placeholder="Enter UPI Transaction ID / UTR number" />
      <button onclick="submitTransactionRef('${orderId}')" class="btn-primary">Verify Payment</button>
    </div>
  `;
}

/**
 * Show screenshot upload
 */
function showScreenshotUpload(orderId) {
  const area = document.getElementById('paymentVerifyArea');
  area.innerHTML = `
    <div class="verify-form">
      <label class="file-upload-label">
        <input type="file" id="screenshotFile" accept="image/*" onchange="previewScreenshot(this)" />
        📷 Select Payment Screenshot
      </label>
      <div id="screenshotPreview"></div>
      <button onclick="submitScreenshot('${orderId}')" class="btn-primary" id="submitScreenshotBtn" disabled>
        🤖 Verify with AI
      </button>
    </div>
  `;
}

/**
 * Preview uploaded screenshot
 */
function previewScreenshot(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('screenshotPreview').innerHTML = `
        <img src="${e.target.result}" class="screenshot-preview" alt="Payment screenshot" />
      `;
      document.getElementById('submitScreenshotBtn').disabled = false;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

/**
 * Submit transaction reference for verification
 */
async function submitTransactionRef(orderId) {
  const ref = document.getElementById('transactionRef').value.trim();
  if (!ref) {
    showToast('Please enter transaction reference', 'error');
    return;
  }

  try {
    showToast('Verifying payment...', 'info');
    const response = await fetch(`${API_BASE_URL}/orders/${orderId}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verificationType: 'manual_ref', transactionRef: ref }),
    });

    const result = await response.json();
    if (result.success) {
      document.getElementById('checkoutModal').classList.add('hidden');
      showOrderConfirmation(orderId, 'UPI', ref);
    } else {
      showToast(result.error || 'Verification failed', 'error');
    }
  } catch (error) {
    showToast('Verification failed. Please try again.', 'error');
  }
}

/**
 * Submit screenshot for AI verification
 */
async function submitScreenshot(orderId) {
  const fileInput = document.getElementById('screenshotFile');
  if (!fileInput.files[0]) {
    showToast('Please select a screenshot', 'error');
    return;
  }

  try {
    showToast('🤖 AI is analyzing your payment screenshot...', 'info');
    document.getElementById('submitScreenshotBtn').disabled = true;
    document.getElementById('submitScreenshotBtn').textContent = '🔄 AI Analyzing...';

    const file = fileInput.files[0];
    const base64 = await fileToBase64(file);

    const response = await fetch(`${API_BASE_URL}/orders/${orderId}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verificationType: 'screenshot', screenshotBase64: base64 }),
    });

    const result = await response.json();
    if (result.success) {
      if (result.paymentStatus === 'PAID') {
        showToast('✅ Payment verified by AI!', 'success');
      } else {
        showToast('📋 Screenshot submitted. Seller will confirm.', 'info');
      }
      document.getElementById('checkoutModal').classList.add('hidden');
      showOrderConfirmation(orderId, 'UPI', result.verification?.transactionRef);
    } else {
      showToast(result.error || 'AI verification failed', 'error');
      document.getElementById('submitScreenshotBtn').disabled = false;
      document.getElementById('submitScreenshotBtn').textContent = '🤖 Verify with AI';
    }
  } catch (error) {
    showToast('Screenshot verification failed', 'error');
    document.getElementById('submitScreenshotBtn').disabled = false;
    document.getElementById('submitScreenshotBtn').textContent = '🤖 Verify with AI';
  }
}

/**
 * Convert file to base64
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Skip payment verification — seller will verify manually
 */
function skipPaymentVerification(orderId) {
  document.getElementById('checkoutModal').classList.add('hidden');
  showOrderConfirmation(orderId, 'UPI', null);
}

/**
 * Show order confirmation screen
 */
function showOrderConfirmation(orderId, paymentMethod, transactionRef) {
  let modal = document.getElementById('orderTrackingModal');
  let container = document.getElementById('orderTrackingContainer');

  // Fallback: create modal dynamically if not found in DOM
  if (!modal || !container) {
    console.warn('orderTrackingModal not found, creating dynamically');
    modal = document.createElement('div');
    modal.id = 'orderTrackingModal';
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-content"><div class="modal-header"><h2>Order Status</h2><button onclick="document.getElementById('orderTrackingModal').classList.add('hidden')" class="close-button">×</button></div><div id="orderTrackingContainer" class="modal-body"></div></div>`;
    document.body.appendChild(modal);
    container = document.getElementById('orderTrackingContainer');
  }

  const paymentBadge = paymentMethod === 'UPI'
    ? (transactionRef
        ? `<span class="badge badge-success">✅ UPI Payment Submitted</span>`
        : `<span class="badge badge-warning">⏳ UPI Payment Pending Verification</span>`)
    : `<span class="badge badge-info">🏠 Cash on Delivery</span>`;

  container.innerHTML = `
    <div class="order-confirmation">
      <div class="success-icon">🎉</div>
      <h2>Order Placed Successfully!</h2>
      <p class="order-id">Order ID: <strong>${orderId}</strong></p>
      ${paymentBadge}

      <div class="order-steps">
        <div class="step active">
          <div class="step-icon">✅</div>
          <div class="step-label">Order Placed</div>
        </div>
        <div class="step">
          <div class="step-icon">📦</div>
          <div class="step-label">Seller Accepts</div>
        </div>
        <div class="step">
          <div class="step-icon">🚚</div>
          <div class="step-label">Shipped</div>
        </div>
        <div class="step">
          <div class="step-icon">🏠</div>
          <div class="step-label">Delivered</div>
        </div>
      </div>

      <p class="order-note">
        ${paymentMethod === 'UPI'
          ? 'Seller has been notified about your payment. They will confirm and pack your order.'
          : 'Seller has been notified. They will contact you to confirm the order.'}
      </p>

      <button onclick="document.getElementById('orderTrackingModal').classList.add('hidden')" class="btn-primary">
        Continue Shopping
      </button>
    </div>
  `;

  modal.classList.remove('hidden');
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

