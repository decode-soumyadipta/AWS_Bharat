/**
 * Vyapar Vaani Marketplace — Professional E-Commerce Frontend
 * All-in-one SPA: Login, Products, Cart, Checkout, UPI, Orders Panel (real-time)
 */

const API_BASE_URL = window.API_BASE_URL || 'https://o72ecc4lpg.execute-api.us-east-1.amazonaws.com/prod/';

// ── Global State ──
let currentUser = null;
let cart = null;
let cartUI = null;
let cachedProducts = [];
let orderPollInterval = null;

// ── Session ──
function loadSession() {
  try { const s = localStorage.getItem('buyer_session'); return s ? JSON.parse(s) : null; }
  catch { return null; }
}
function saveSession(user) {
  localStorage.setItem('buyer_session', JSON.stringify(user));
  currentUser = user;
}
function clearSession() { localStorage.removeItem('buyer_session'); currentUser = null; }

// ── Order Storage (localStorage) ──
function getStoredOrders() {
  try { return JSON.parse(localStorage.getItem('buyer_orders') || '[]'); }
  catch { return []; }
}
function storeOrder(order) {
  const orders = getStoredOrders();
  orders.unshift(order);
  if (orders.length > 50) orders.length = 50;
  localStorage.setItem('buyer_orders', JSON.stringify(orders));
}
function updateStoredOrder(orderId, updates) {
  const orders = getStoredOrders();
  const idx = orders.findIndex(o => o.orderId === orderId);
  if (idx >= 0) Object.assign(orders[idx], updates);
  localStorage.setItem('buyer_orders', JSON.stringify(orders));
}

// ── Init ──
function initializeApp() {
  currentUser = loadSession();
  currentUser ? showMarketplace() : showLoginScreen();
}

// ── LOGIN ──
function showLoginScreen() {
  if (orderPollInterval) { clearInterval(orderPollInterval); orderPollInterval = null; }
  document.body.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="brand">
          <img src="logo.png" alt="Vyapar Vaani" class="brand-logo" />
          <h1>Vyapar Vaani</h1>
          <p>Farm-fresh marketplace</p>
        </div>
        <form id="loginForm">
          <div class="form-group">
            <label>Your Name</label>
            <input type="text" id="buyerName" required placeholder="Enter your name" />
          </div>
          <div class="form-group">
            <label>Phone Number</label>
            <input type="tel" id="buyerPhone" required placeholder="10-digit phone" pattern="[0-9]{10,15}" />
          </div>
          <button type="submit" class="btn-login">Continue to Marketplace</button>
        </form>
      </div>
    </div>`;
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
}

function handleLogin(e) {
  e.preventDefault();
  const name = document.getElementById('buyerName').value.trim();
  const phone = document.getElementById('buyerPhone').value.trim();
  if (!name || !phone) return showToast('Enter both name and phone', 'error');
  if (phone.length < 10) return showToast('Phone must be 10+ digits', 'error');
  saveSession({ name, phone });
  showMarketplace();
}

// ── MARKETPLACE ──
function showMarketplace() {
  document.body.innerHTML = `
    <!-- Top Header -->
    <header class="top-header">
      <div class="logo">
        <img src="logo.png" alt="Vyapar Vaani" class="logo-img" />
        <span class="logo-text">Vyapar <span>Vaani</span></span>
      </div>
      <div class="search-bar">
        <input type="text" id="searchInput" placeholder="Search products..." />
        <select id="categoryFilter">
          <option value="">All</option>
          <option value="Vegetables">Vegetables</option>
          <option value="Fruits">Fruits</option>
          <option value="Grains">Grains</option>
          <option value="Dairy">Dairy</option>
          <option value="Grocery">Grocery</option>
        </select>
      </div>
      <div class="header-actions">
        <button class="header-btn" id="userBtn">
          <div>
            <div class="btn-label">Hello, ${currentUser.name}</div>
            <div class="btn-value">Account</div>
          </div>
        </button>
        <button class="header-btn orders-btn" id="ordersMobileBtn" style="display:none;">
          📋 <span class="btn-value">Orders</span>
        </button>
        <button class="header-btn cart-btn" id="cartBtn">
          <span class="cart-icon">🛒</span>
          <div>
            <div class="btn-label">Your</div>
            <div class="btn-value">Cart</div>
          </div>
          <span class="cart-count" id="cartCount">0</span>
        </button>
      </div>
    </header>

    <!-- Sub Header -->
    <nav class="sub-header">
      <a data-cat="">All Products</a>
      <a data-cat="Vegetables">🥬 Vegetables</a>
      <a data-cat="Fruits">🍎 Fruits</a>
      <a data-cat="Grains">🌾 Grains</a>
      <a data-cat="Dairy">🥛 Dairy</a>
      <a data-cat="Grocery">🛍️ Grocery</a>
    </nav>

    <!-- Main Layout -->
    <div class="main-layout">
      <div class="products-area">
        <div id="productsGrid" class="products-grid">
          <div class="loading-grid">
            ${Array(8).fill('<div class="skeleton skeleton-card"></div>').join('')}
          </div>
        </div>
      </div>
      <aside class="orders-panel" id="ordersPanel">
        <div class="orders-panel-header">
          <h3>📋 My Orders</h3>
          <span class="live-dot" title="Live updates"></span>
        </div>
        <div class="orders-panel-body" id="ordersPanelBody"></div>
      </aside>
    </div>

    <!-- Cart Overlay + Sidebar -->
    <div class="cart-overlay" id="cartOverlay"></div>
    <div class="cart-sidebar" id="cartSidebar">
      <div class="cart-header">
        <h2>🛒 Shopping Cart</h2>
        <button class="close-btn" id="closeCartBtn">✕</button>
      </div>
      <div class="cart-body" id="cartBody"></div>
      <div class="cart-footer" id="cartFooter"></div>
    </div>

    <!-- Checkout Modal -->
    <div class="modal-overlay" id="checkoutModal">
      <div class="modal-box">
        <div class="modal-header">
          <h2>🛍️ Checkout</h2>
          <button class="close-btn" id="closeCheckoutBtn">✕</button>
        </div>
        <div class="modal-body" id="checkoutBody"></div>
      </div>
    </div>

    <!-- Order Confirmation / UPI Modal -->
    <div class="modal-overlay" id="orderModal">
      <div class="modal-box">
        <div class="modal-header">
          <h2>Order Status</h2>
          <button class="close-btn" id="closeOrderBtn">✕</button>
        </div>
        <div class="modal-body" id="orderBody"></div>
      </div>
    </div>

    <!-- Mobile Orders Drawer -->
    <div class="orders-mobile-overlay" id="ordersMobileOverlay"></div>
    <div class="orders-mobile" id="ordersMobile">
      <div class="cart-header">
        <h2>📋 My Orders</h2>
        <button class="close-btn" id="closeOrdersMobileBtn">✕</button>
      </div>
      <div class="orders-panel-body" id="ordersMobileBody"></div>
    </div>

    <!-- Toast Container -->
    <div class="toast-container" id="toastContainer"></div>

    <!-- ONDC Network Footer -->
    <footer class="ondc-footer">
      <div class="ondc-footer-inner">
        <span>🔗 Powered by <strong>ONDC Network</strong> · Beckn Protocol v1.2.0</span>
        <span class="ondc-badge-footer">Open Network for Digital Commerce</span>
      </div>
    </footer>`;

  initComponents();
}

// ── Initialize Components ──
function initComponents() {
  cart = new ShoppingCart();
  cart.loadFromStorage();
  cartUI = new CartUI(cart, 'cartBody');
  updateCartBadge();

  // Events
  document.getElementById('cartBtn').addEventListener('click', openCart);
  document.getElementById('closeCartBtn').addEventListener('click', closeCart);
  document.getElementById('cartOverlay').addEventListener('click', closeCart);
  document.getElementById('closeCheckoutBtn').addEventListener('click', () => document.getElementById('checkoutModal').classList.remove('open'));
  document.getElementById('closeOrderBtn').addEventListener('click', () => document.getElementById('orderModal').classList.remove('open'));
  document.getElementById('searchInput').addEventListener('input', handleSearch);
  document.getElementById('categoryFilter').addEventListener('change', handleCategoryFilter);
  document.getElementById('userBtn').addEventListener('click', handleLogout);

  // Mobile orders
  const mBtn = document.getElementById('ordersMobileBtn');
  if (window.innerWidth <= 900) mBtn.style.display = '';
  window.addEventListener('resize', () => { mBtn.style.display = window.innerWidth <= 900 ? '' : 'none'; });
  mBtn.addEventListener('click', openOrdersMobile);
  document.getElementById('closeOrdersMobileBtn').addEventListener('click', closeOrdersMobile);
  document.getElementById('ordersMobileOverlay').addEventListener('click', closeOrdersMobile);

  // Sub-header nav
  document.querySelectorAll('.sub-header a').forEach(a => {
    a.addEventListener('click', () => {
      const cat = a.dataset.cat;
      document.getElementById('categoryFilter').value = cat;
      filterProducts(cat, document.getElementById('searchInput').value);
    });
  });

  loadProducts();
  setInterval(loadProducts, 10000);
  renderOrdersPanel();
  startOrderPolling();
}

// ── PRODUCTS ──
async function loadProducts() {
  try {
    const r = await fetch(`${API_BASE_URL}/products`);
    const d = await r.json();
    if (d.success && d.products) {
      const changed = productsChanged(d.products);
      if (changed || cachedProducts.length === 0) {
        cachedProducts = d.products;
        renderProducts(d.products);
      } else {
        // Update presigned URLs without full re-render
        d.products.forEach(p => {
          if (p.imageUrl) {
            const card = document.querySelector(`.product-card[data-pid="${CSS.escape(p.productId)}"]`);
            if (card) { const img = card.querySelector('.card-img img'); if (img && img.src !== p.imageUrl) img.src = p.imageUrl; }
          }
        });
        cachedProducts = d.products;
      }
    }
  } catch (e) {
    console.error('Failed to load products:', e);
    if (cachedProducts.length === 0) {
      document.getElementById('productsGrid').innerHTML = '<div class="empty-state"><div class="empty-icon">😞</div><p>Failed to load products. Try again later.</p></div>';
    }
  }
}

function productsChanged(newP) {
  if (newP.length !== cachedProducts.length) return true;
  return newP.some(p => {
    const c = cachedProducts.find(x => x.productId === p.productId);
    return !c || c.price !== p.price || c.quantity !== p.quantity || c.name !== p.name;
  });
}

function renderProducts(products) {
  const grid = document.getElementById('productsGrid');
  if (!products.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><p>No products yet. Products added by sellers via WhatsApp will appear here!</p></div>';
    return;
  }
  grid.innerHTML = products.map(p => {
    const img = p.imageUrl
      ? `<img src="${p.imageUrl}" alt="${p.name}" onerror="this.parentElement.innerHTML='<div class=\\'placeholder\\'>📦</div>'" />`
      : '<div class="placeholder">📦</div>';
    const desc = p.description ? (p.description.length > 60 ? p.description.substring(0, 60) + '...' : p.description) : '';
    const qs = p.qualityScore;
    const qBadge = qs && qs.badge && (qs.badge === 'excellent' || qs.badge === 'good')
      ? `<span class="badge-sm badge-quality">${qs.badge === 'excellent' ? '⭐ Top Quality' : '✅ Good'}</span>` : '';
    const uBadge = p.seller && p.seller.upiId ? '<span class="badge-sm badge-upi">💳 UPI</span>' : '';
    const ondcBadge = p.ondcDomain ? '<span class="badge-sm badge-ondc">🔗 ONDC</span>' : '';
    const codBadge = p.codAvailable ? '<span class="badge-sm badge-cod">🏠 COD</span>' : '';
    const outOfStock = p.quantity <= 0;
    const lowStock = p.quantity > 0 && p.quantity <= 5;
    const stockClass = outOfStock ? 'out' : (lowStock ? 'low' : '');
    const stockText = outOfStock ? 'Out of Stock' : (lowStock ? `Only ${p.quantity} left!` : `${p.quantity} ${p.unit} available`);
    return `
      <div class="product-card" data-pid="${p.productId}" data-cat="${p.category || ''}">
        <div class="card-img">
          ${img}
          <div class="badges">${qBadge}${uBadge}${ondcBadge}${codBadge}${outOfStock ? '<span class="badge-sm badge-stock">Sold Out</span>' : ''}</div>
        </div>
        <div class="card-body">
          <div class="p-name">${p.name}</div>
          <div class="p-seller">by ${p.seller ? p.seller.name : 'Unknown'}</div>
          ${desc ? `<div class="p-desc">${desc}</div>` : ''}
          <div class="p-price">₹${p.price} <span class="unit">/ ${p.unit}</span></div>
          <div class="p-stock ${stockClass}">${stockText}</div>
          <div class="card-actions">
            <button class="btn-add-cart ${outOfStock ? 'btn-disabled' : ''}" ${outOfStock ? 'disabled' : ''} data-product='${JSON.stringify(p).replace(/'/g, "&apos;")}'>🛒 Add to Cart</button>
            <button class="btn-buy-now ${outOfStock ? 'btn-disabled' : ''}" ${outOfStock ? 'disabled' : ''} data-product='${JSON.stringify(p).replace(/'/g, "&apos;")}'>⚡ Buy Now</button>
          </div>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.btn-add-cart:not(.btn-disabled)').forEach(b => b.addEventListener('click', handleAddToCart));
  grid.querySelectorAll('.btn-buy-now:not(.btn-disabled)').forEach(b => b.addEventListener('click', handleBuyNow));
}

function handleAddToCart(e) {
  const p = JSON.parse(e.target.closest('.btn-add-cart').dataset.product);
  cart.addItem(p.productId, 1, { name: p.name, price: p.price, seller: p.seller, unit: p.unit, imageUrl: p.imageUrl || '' });
  cart.saveToStorage();
  updateCartBadge();
  showToast(`${p.name} added to cart!`);
}

function handleBuyNow(e) {
  const p = JSON.parse(e.target.closest('.btn-buy-now').dataset.product);
  cart.clear();
  cart.addItem(p.productId, 1, { name: p.name, price: p.price, seller: p.seller, unit: p.unit, imageUrl: p.imageUrl || '' });
  cart.saveToStorage();
  updateCartBadge();
  showCheckout();
}

function handleSearch(e) { filterProducts(document.getElementById('categoryFilter').value, e.target.value); }
function handleCategoryFilter(e) { filterProducts(e.target.value, document.getElementById('searchInput').value); }
function filterProducts(cat, search) {
  const s = (search || '').toLowerCase();
  document.querySelectorAll('.product-card').forEach(c => {
    const matchCat = !cat || c.dataset.cat === cat;
    const matchSearch = !s || c.querySelector('.p-name').textContent.toLowerCase().includes(s);
    c.style.display = matchCat && matchSearch ? '' : 'none';
  });
}

// ── CART SIDEBAR ──
function openCart() {
  renderCartSidebar();
  document.getElementById('cartOverlay').classList.add('open');
  document.getElementById('cartSidebar').classList.add('open');
}
function closeCart() {
  document.getElementById('cartOverlay').classList.remove('open');
  document.getElementById('cartSidebar').classList.remove('open');
}

function renderCartSidebar() {
  const items = cart.getItems();
  const body = document.getElementById('cartBody');
  const footer = document.getElementById('cartFooter');
  if (!items.length) {
    body.innerHTML = '<div class="empty-cart-msg"><div class="empty-icon">🛒</div><p>Your cart is empty</p></div>';
    footer.innerHTML = '';
    return;
  }
  body.innerHTML = items.map((it, i) => `
    <div class="cart-item-row">
      <div class="ci-info">
        <div class="ci-name">${it.name}</div>
        <div class="ci-meta">${it.seller ? it.seller.name : ''} · ₹${it.price}/${it.unit}</div>
      </div>
      <div class="ci-qty">
        <button class="qty-btn" data-idx="${i}" data-dir="-1">−</button>
        <span class="qty-val">${it.quantity}</span>
        <button class="qty-btn" data-idx="${i}" data-dir="1">+</button>
      </div>
      <div class="ci-price">₹${(it.price * it.quantity).toFixed(2)}</div>
      <button class="ci-remove" data-pid="${it.productId}">Remove</button>
    </div>`).join('');
  footer.innerHTML = `
    <div class="total-row"><span>Subtotal (${cart.getItemCount()} items)</span><span>₹${cart.getTotalPrice().toFixed(2)}</span></div>
    <button class="btn-primary" id="proceedCheckoutBtn">Proceed to Checkout</button>`;
  // Events
  body.querySelectorAll('.qty-btn').forEach(b => b.addEventListener('click', (e) => {
    const idx = +e.target.dataset.idx;
    const dir = +e.target.dataset.dir;
    const item = items[idx];
    if (dir === -1 && item.quantity <= 1) { cart.removeItem(item.productId); }
    else { cart.updateQuantity(item.productId, item.quantity + dir); }
    cart.saveToStorage(); updateCartBadge(); renderCartSidebar();
  }));
  body.querySelectorAll('.ci-remove').forEach(b => b.addEventListener('click', (e) => {
    cart.removeItem(e.target.dataset.pid); cart.saveToStorage(); updateCartBadge(); renderCartSidebar();
    showToast('Item removed');
  }));
  document.getElementById('proceedCheckoutBtn').addEventListener('click', () => { closeCart(); showCheckout(); });
}

function updateCartBadge() {
  const el = document.getElementById('cartCount');
  if (el) el.textContent = cart ? cart.getItemCount() : 0;
}

// ── CHECKOUT ──
function showCheckout() {
  const items = cart.getItems();
  if (!items.length) return showToast('Cart is empty', 'error');

  // Check UPI availability
  let hasUpi = items.some(i => i.seller && i.seller.upiId);
  if (!hasUpi && cachedProducts.length) {
    hasUpi = items.some(ci => {
      const fp = cachedProducts.find(p => p.productId === ci.productId);
      if (fp && fp.seller && fp.seller.upiId) { ci.seller = fp.seller; return true; }
      return false;
    });
    if (hasUpi) cart.saveToStorage();
  }

  const body = document.getElementById('checkoutBody');
  body.innerHTML = `
    <form id="checkoutForm">
      <div class="checkout-section">
        <h4>📍 Delivery Address</h4>
        <div class="form-group">
          <label>Name</label>
          <input type="text" id="addrName" value="${currentUser.name}" required />
        </div>
        <div class="form-group">
          <label>Phone</label>
          <input type="tel" id="addrPhone" value="${currentUser.phone}" required />
        </div>
        <div class="form-group">
          <label>Street Address</label>
          <input type="text" id="addrStreet" required placeholder="House no., Street..." />
        </div>
        <div class="form-row">
          <div class="form-group"><label>City</label><input type="text" id="addrCity" required /></div>
          <div class="form-group"><label>State</label><input type="text" id="addrState" required /></div>
          <div class="form-group"><label>PIN</label><input type="text" id="addrPin" pattern="[0-9]{6}" required /></div>
        </div>
      </div>
      <div class="checkout-section">
        <h4>💳 Payment Method</h4>
        <div class="payment-options">
          ${hasUpi ? `
          <label class="payment-opt selected" onclick="this.parentElement.querySelectorAll('.payment-opt').forEach(x=>x.classList.remove('selected'));this.classList.add('selected');">
            <input type="radio" name="payMethod" value="UPI" checked />
            <span class="po-icon">📱</span>
            <div class="po-label"><strong>UPI Payment</strong><small>GPay, PhonePe, Paytm — Instant</small></div>
          </label>` : ''}
          <label class="payment-opt ${!hasUpi ? 'selected' : ''}" onclick="this.parentElement.querySelectorAll('.payment-opt').forEach(x=>x.classList.remove('selected'));this.classList.add('selected');">
            <input type="radio" name="payMethod" value="COD" ${!hasUpi ? 'checked' : ''} />
            <span class="po-icon">🏠</span>
            <div class="po-label"><strong>Cash on Delivery</strong><small>Pay when delivered</small></div>
          </label>
        </div>
      </div>
      <div class="checkout-section">
        <h4>🛒 Order Summary</h4>
        ${items.map(i => `<div class="order-summary-row"><span>${i.name} × ${i.quantity}</span><span>₹${(i.price * i.quantity).toFixed(2)}</span></div>`).join('')}
        <div class="order-summary-row total"><span>Total</span><span>₹${cart.getTotalPrice().toFixed(2)}</span></div>
      </div>
      <button type="submit" class="btn-primary">Place Order</button>
    </form>`;

  document.getElementById('checkoutModal').classList.add('open');
  document.getElementById('checkoutForm').addEventListener('submit', handleSubmitOrder);
}

// ── ORDER SUBMISSION ──
async function handleSubmitOrder(e) {
  e.preventDefault();
  const paymentMethod = document.querySelector('input[name="payMethod"]:checked')?.value || 'COD';
  const orderData = {
    buyer: {
      name: document.getElementById('addrName').value,
      phone: document.getElementById('addrPhone').value,
      address: {
        name: document.getElementById('addrName').value,
        phone: document.getElementById('addrPhone').value,
        street: document.getElementById('addrStreet').value,
        city: document.getElementById('addrCity').value,
        state: document.getElementById('addrState').value,
        postalCode: document.getElementById('addrPin').value,
      },
    },
    items: cart.getItems(),
    totalAmount: cart.getTotalPrice(),
    paymentMethod,
  };
  try {
    showToast('Placing order...', 'info');
    const r = await fetch(`${API_BASE_URL}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderData) });
    const result = await r.json();
    if (result.success || r.status === 207) {
      // Store order(s) locally for panel tracking
      // For multi-seller orders, store each seller's orderId separately so polling works
      const sellerResults = (result.results || []).filter(r => r.success && r.orderId);
      if (sellerResults.length > 0) {
        sellerResults.forEach(sr => {
          storeOrder({
            orderId: sr.orderId,
            items: orderData.items.filter(i => i.seller?.name === sr.seller).map(i => ({ name: i.name, qty: i.quantity })),
            totalAmount: orderData.totalAmount,
            paymentMethod,
            status: paymentMethod === 'UPI' ? 'CONFIRMED' : 'PENDING',
            createdAt: new Date().toISOString(),
          });
        });
      } else {
        // Fallback: single order
        storeOrder({
          orderId: result.orderId,
          items: orderData.items.map(i => ({ name: i.name, qty: i.quantity })),
          totalAmount: orderData.totalAmount,
          paymentMethod,
          status: paymentMethod === 'UPI' ? 'CONFIRMED' : 'PENDING',
          createdAt: new Date().toISOString(),
        });
      }
      cart.clear(); cart.saveToStorage(); updateCartBadge();
      renderOrdersPanel();

      if (paymentMethod === 'UPI') {
        showUpiPayment(result.orderId, orderData.totalAmount, orderData.items);
      } else {
        document.getElementById('checkoutModal').classList.remove('open');
        showOrderConfirmation(result.orderId, 'COD');
      }
    } else {
      showToast('Order failed. Try again.', 'error');
    }
  } catch (err) {
    console.error('Order submission failed:', err);
    showToast('Order failed. Try again.', 'error');
  }
}

// ── UPI PAYMENT ──
function showUpiPayment(orderId, total, items) {
  const sellerMap = {};
  items.forEach(i => {
    if (i.seller && i.seller.upiId) {
      const k = i.seller.phone;
      if (!sellerMap[k]) sellerMap[k] = { upiId: i.seller.upiId, name: i.seller.name, amount: 0 };
      sellerMap[k].amount += i.price * i.quantity;
    }
  });
  const seller = Object.values(sellerMap)[0] || { upiId: '', name: 'Seller', amount: total };
  const upiLink = `upi://pay?pa=${encodeURIComponent(seller.upiId)}&pn=${encodeURIComponent(seller.name)}&am=${seller.amount.toFixed(2)}&cu=INR&tn=Order+${orderId}`;

  const body = document.getElementById('checkoutBody');
  body.innerHTML = `
    <div class="upi-screen">
      <h3>📱 UPI Payment</h3>
      <div class="upi-amount">₹${total.toFixed(2)}</div>
      <div class="upi-to">to <strong>${seller.name}</strong></div>
      <div class="upi-qr-container">
        <img id="upiQrImg"
             src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiLink)}&format=png&margin=10"
             alt="UPI QR" width="200" height="200"
             onerror="this.style.display='none'; document.getElementById('qrFallback').style.display='block';" />
        <canvas id="upiQrCanvas" style="display:none;"></canvas>
        <div id="qrFallback" style="display:none;padding:20px;text-align:center;color:#999;">QR could not load.</div>
        <p class="upi-id-text">${seller.upiId}</p>
      </div>
      <a href="${upiLink}" class="btn-upi-deep">📱 Open UPI App</a>
      <div class="upi-divider"><span>After payment</span></div>
      <div class="verify-btns">
        <button class="btn-secondary" onclick="showRefInput('${orderId}')">✏️ Enter Ref</button>
        <button class="btn-secondary" onclick="showScreenshotUpload('${orderId}')">📸 Upload Screenshot</button>
      </div>
      <div id="paymentVerifyArea"></div>
      <button class="btn-text" onclick="skipVerification('${orderId}')">Skip — seller will verify</button>
    </div>`;

  // Canvas QR backup
  try {
    if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
      QRCode.toCanvas(document.getElementById('upiQrCanvas'), upiLink, { width: 200, margin: 2 }, () => {});
    }
  } catch {}
}

function showRefInput(orderId) {
  document.getElementById('paymentVerifyArea').innerHTML = `
    <div class="verify-form">
      <input type="text" id="txnRef" placeholder="Enter UPI Transaction ID / UTR" />
      <button class="btn-primary" onclick="submitRef('${orderId}')">Verify Payment</button>
    </div>`;
}

function showScreenshotUpload(orderId) {
  document.getElementById('paymentVerifyArea').innerHTML = `
    <div class="verify-form">
      <label class="file-upload-label">
        <input type="file" id="ssFile" accept="image/*" onchange="previewSS(this)" />
        📷 Select Screenshot
      </label>
      <div id="ssPreview"></div>
      <button class="btn-primary" id="ssSubmitBtn" onclick="submitSS('${orderId}')" disabled>🤖 Verify with AI</button>
    </div>`;
}

function previewSS(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('ssPreview').innerHTML = `<img src="${e.target.result}" class="screenshot-preview" />`;
      document.getElementById('ssSubmitBtn').disabled = false;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function submitRef(orderId) {
  const ref = document.getElementById('txnRef').value.trim();
  if (!ref) return showToast('Enter transaction ref', 'error');
  try {
    showToast('Verifying...', 'info');
    const r = await fetch(`${API_BASE_URL}/orders/${orderId}/verify-payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verificationType: 'manual_ref', transactionRef: ref }),
    });
    const res = await r.json();
    if (res.success) { document.getElementById('checkoutModal').classList.remove('open'); showOrderConfirmation(orderId, 'UPI', ref); }
    else showToast(res.error || 'Verification failed', 'error');
  } catch { showToast('Verification failed', 'error'); }
}

async function submitSS(orderId) {
  const file = document.getElementById('ssFile')?.files[0];
  if (!file) return showToast('Select a screenshot', 'error');
  try {
    showToast('🤖 AI analyzing screenshot...', 'info');
    const btn = document.getElementById('ssSubmitBtn');
    btn.disabled = true; btn.textContent = '🔄 Analyzing...';
    const base64 = await fileToBase64(file);
    const r = await fetch(`${API_BASE_URL}/orders/${orderId}/verify-payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verificationType: 'screenshot', screenshotBase64: base64 }),
    });
    const res = await r.json();
    if (res.success) {
      showToast(res.paymentStatus === 'PAID' ? '✅ Payment verified!' : '📋 Submitted for review', res.paymentStatus === 'PAID' ? 'success' : 'info');
      document.getElementById('checkoutModal').classList.remove('open');
      showOrderConfirmation(orderId, 'UPI', res.verification?.transactionRef);
    } else {
      showToast(res.error || 'AI verification failed', 'error');
      btn.disabled = false; btn.textContent = '🤖 Verify with AI';
    }
  } catch { showToast('Screenshot verification failed', 'error'); }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function skipVerification(orderId) {
  document.getElementById('checkoutModal').classList.remove('open');
  showOrderConfirmation(orderId, 'UPI', null);
}

// ── ORDER CONFIRMATION ──
function showOrderConfirmation(orderId, paymentMethod, txnRef) {
  const body = document.getElementById('orderBody');
  const badge = paymentMethod === 'UPI'
    ? (txnRef ? '<span class="oc-status status-paid">✅ UPI Submitted</span>' : '<span class="oc-status status-pending">⏳ UPI Pending</span>')
    : '<span class="oc-status status-confirmed">🏠 Cash on Delivery</span>';
  body.innerHTML = `
    <div class="order-confirm">
      <div class="success-icon">🎉</div>
      <h2>Order Placed!</h2>
      <p class="oc-id">Order ID: ${orderId}</p>
      ${badge}
      <div class="order-steps">
        <div class="order-step active"><div class="step-icon">✅</div><div class="step-label">Placed</div></div>
        <div class="order-step"><div class="step-icon">📦</div><div class="step-label">Accepted</div></div>
        <div class="order-step"><div class="step-icon">🚚</div><div class="step-label">Shipped</div></div>
        <div class="order-step"><div class="step-icon">🏠</div><div class="step-label">Delivered</div></div>
      </div>
      <p class="order-note">${paymentMethod === 'UPI' ? 'Seller notified. They will confirm & pack your order.' : 'Seller notified. They will contact you to confirm.'}</p>
      <button class="btn-primary" onclick="document.getElementById('orderModal').classList.remove('open')">Continue Shopping</button>
    </div>`;
  document.getElementById('orderModal').classList.add('open');
}

// ── ORDERS PANEL (right side) ──
function renderOrdersPanel() {
  const orders = getStoredOrders();
  const panelBody = document.getElementById('ordersPanelBody');
  const mobileBody = document.getElementById('ordersMobileBody');
  const html = orders.length ? orders.map(renderOrderCard).join('') :
    '<div class="orders-empty"><div class="empty-icon">📋</div><p>No orders yet.<br>Your orders will appear here!</p></div>';
  if (panelBody) panelBody.innerHTML = html;
  if (mobileBody) mobileBody.innerHTML = html;
}

function renderOrderCard(o) {
  const statusMap = {
    PENDING: { cls: 'status-pending', icon: '⏳', label: 'Pending' },
    CONFIRMED: { cls: 'status-confirmed', icon: '✅', label: 'Accepted' },
    CANCELLED: { cls: 'status-cancelled', icon: '❌', label: 'Cancelled' },
    SHIPPED: { cls: 'status-shipped', icon: '🚚', label: 'Shipped' },
    DELIVERED: { cls: 'status-delivered', icon: '📦', label: 'Delivered' },
    PAID: { cls: 'status-paid', icon: '💰', label: 'Paid' },
  };
  const s = statusMap[o.status] || statusMap.PENDING;
  const itemsText = o.items ? o.items.map(i => `${i.name} × ${i.qty || i.quantity || 1}`).join(', ') : '';
  return `
    <div class="order-card">
      <div class="oc-top">
        <span class="oc-id">#${(o.orderId || '').slice(-8)}</span>
        <span class="oc-time">${timeAgo(o.createdAt)}</span>
      </div>
      <div class="oc-items">${itemsText}</div>
      <div class="oc-amount">₹${(o.totalAmount || 0).toFixed(2)}</div>
      <span class="oc-status ${s.cls}">${s.icon} ${s.label}</span>
    </div>`;
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── ORDER POLLING ──
function startOrderPolling() {
  if (orderPollInterval) clearInterval(orderPollInterval);
  pollOrders(); // immediate first poll
  orderPollInterval = setInterval(pollOrders, 8000);
}

async function pollOrders() {
  const orders = getStoredOrders();
  const active = orders.filter(o => o.status === 'PENDING' || o.status === 'CONFIRMED' || o.status === 'SHIPPED' || o.status === 'PAID');
  if (!active.length) return;

  let changed = false;
  for (const o of active) {
    try {
      const r = await fetch(`${API_BASE_URL}/orders/${o.orderId}`);
      if (!r.ok) continue;
      const data = await r.json();
      const newStatus = data.status || data.order?.status;
      if (newStatus && newStatus !== o.status) {
        updateStoredOrder(o.orderId, { status: newStatus });
        changed = true;
        // Show toast for important status changes
        const labels = { CONFIRMED: '✅ Order accepted by seller!', CANCELLED: '❌ Order was cancelled', SHIPPED: '🚚 Order shipped!', DELIVERED: '📦 Order delivered!' };
        if (labels[newStatus]) showToast(labels[newStatus], newStatus === 'CANCELLED' ? 'error' : 'success');
      }
    } catch {}
  }
  if (changed) renderOrdersPanel();
}

// ── MOBILE ORDERS DRAWER ──
function openOrdersMobile() {
  renderOrdersPanel();
  document.getElementById('ordersMobileOverlay').classList.add('open');
  document.getElementById('ordersMobile').classList.add('open');
}
function closeOrdersMobile() {
  document.getElementById('ordersMobileOverlay').classList.remove('open');
  document.getElementById('ordersMobile').classList.remove('open');
}

// ── LOGOUT ──
function handleLogout() {
  if (confirm('Logout?')) {
    clearSession();
    if (cart) { cart.clear(); cart.saveToStorage(); }
    showLoginScreen();
  }
}

// ── TOAST ──
function showToast(msg, type = 'success') {
  const c = document.getElementById('toastContainer') || document.body;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ── BOOT ──
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeApp);
else initializeApp();

