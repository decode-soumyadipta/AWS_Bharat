// Mock data - Products added by sellers through WhatsApp
const mockProducts = [
    {
        id: 1,
        name: 'आम का अचार',
        nameEn: 'Mango Pickle',
        description: 'घर का बना हुआ ताज़ा आम का अचार',
        descriptionEn: 'Homemade fresh mango pickle',
        price: 200,
        quantity: 5,
        unit: 'kg',
        category: 'food',
        seller: {
            name: 'राज किराना',
            phone: '+919876543210'
        },
        image: '🥭',
        addedVia: 'WhatsApp Voice'
    },
    {
        id: 2,
        name: 'हस्तनिर्मित दुपट्टा',
        nameEn: 'Handmade Dupatta',
        description: 'पारंपरिक हाथ से बुना हुआ दुपट्टा',
        descriptionEn: 'Traditional hand-woven dupatta',
        price: 850,
        quantity: 10,
        unit: 'piece',
        category: 'clothing',
        seller: {
            name: 'सीमा हस्तशिल्प',
            phone: '+919876543211'
        },
        image: '🧣',
        addedVia: 'WhatsApp Image'
    },
    {
        id: 3,
        name: 'ताज़ा दूध',
        nameEn: 'Fresh Milk',
        description: 'शुद्ध गाय का दूध, रोज़ाना सुबह की डिलीवरी',
        descriptionEn: 'Pure cow milk, daily morning delivery',
        price: 60,
        quantity: 20,
        unit: 'litre',
        category: 'grocery',
        seller: {
            name: 'गोपाल डेयरी',
            phone: '+919876543212'
        },
        image: '🥛',
        addedVia: 'WhatsApp Voice'
    },
    {
        id: 4,
        name: 'मिट्टी के बर्तन',
        nameEn: 'Clay Pots',
        description: 'हाथ से बने पारंपरिक मिट्टी के बर्तन',
        descriptionEn: 'Handmade traditional clay pots',
        price: 150,
        quantity: 15,
        unit: 'piece',
        category: 'handicraft',
        seller: {
            name: 'कुम्हार भाई',
            phone: '+919876543213'
        },
        image: '🏺',
        addedVia: 'WhatsApp Image'
    },
    {
        id: 5,
        name: 'ऑर्गेनिक शहद',
        nameEn: 'Organic Honey',
        description: 'शुद्ध जंगली शहद, बिना मिलावट',
        descriptionEn: 'Pure wild honey, no additives',
        price: 400,
        quantity: 8,
        unit: 'kg',
        category: 'food',
        seller: {
            name: 'मधुमक्खी फार्म',
            phone: '+919876543214'
        },
        image: '🍯',
        addedVia: 'WhatsApp Voice'
    },
    {
        id: 6,
        name: 'हाथ से बुना कालीन',
        nameEn: 'Hand-woven Carpet',
        description: 'पारंपरिक डिज़ाइन का हाथ से बुना कालीन',
        descriptionEn: 'Traditional design hand-woven carpet',
        price: 2500,
        quantity: 3,
        unit: 'piece',
        category: 'handicraft',
        seller: {
            name: 'कालीन कारीगर',
            phone: '+919876543215'
        },
        image: '🧶',
        addedVia: 'WhatsApp Image'
    },
    {
        id: 7,
        name: 'ताज़ी सब्जियां',
        nameEn: 'Fresh Vegetables',
        description: 'खेत से सीधे ताज़ी सब्जियां',
        descriptionEn: 'Farm fresh vegetables',
        price: 50,
        quantity: 25,
        unit: 'kg',
        category: 'grocery',
        seller: {
            name: 'किसान मंडी',
            phone: '+919876543216'
        },
        image: '🥬',
        addedVia: 'WhatsApp Voice'
    },
    {
        id: 8,
        name: 'कढ़ाई वाली साड़ी',
        nameEn: 'Embroidered Saree',
        description: 'हाथ की कढ़ाई वाली खूबसूरत साड़ी',
        descriptionEn: 'Beautiful hand-embroidered saree',
        price: 1800,
        quantity: 5,
        unit: 'piece',
        category: 'clothing',
        seller: {
            name: 'साड़ी संग्रह',
            phone: '+919876543217'
        },
        image: '👘',
        addedVia: 'WhatsApp Image'
    }
];

// State
let currentBuyer = null;
let cart = [];
let allProducts = [...mockProducts];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkLogin();
});

// Login
function login() {
    const name = document.getElementById('buyerName').value.trim();
    const phone = document.getElementById('buyerPhone').value.trim();
    
    if (!name || !phone) {
        alert('Please enter both name and phone number');
        return;
    }
    
    if (phone.length < 10) {
        alert('Please enter a valid phone number');
        return;
    }
    
    currentBuyer = { name, phone };
    localStorage.setItem('buyer', JSON.stringify(currentBuyer));
    
    showMarketplace();
}

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        currentBuyer = null;
        cart = [];
        localStorage.removeItem('buyer');
        localStorage.removeItem('cart');
        showLogin();
    }
}

function checkLogin() {
    const savedBuyer = localStorage.getItem('buyer');
    const savedCart = localStorage.getItem('cart');
    
    if (savedBuyer) {
        currentBuyer = JSON.parse(savedBuyer);
        if (savedCart) {
            cart = JSON.parse(savedCart);
        }
        showMarketplace();
    } else {
        showLogin();
    }
}

function showLogin() {
    document.getElementById('loginScreen').classList.add('active');
    document.getElementById('marketplaceScreen').classList.remove('active');
}

function showMarketplace() {
    document.getElementById('loginScreen').classList.remove('active');
    document.getElementById('marketplaceScreen').classList.add('active');
    document.getElementById('buyerNameDisplay').textContent = `Hello, ${currentBuyer.name}!`;
    updateCartCount();
    loadProducts();
}

// Products
function loadProducts() {
    const grid = document.getElementById('productsGrid');
    
    if (allProducts.length === 0) {
        grid.innerHTML = '<div class="empty-message">No products available yet. Check back soon!</div>';
        return;
    }
    
    grid.innerHTML = allProducts.map(product => `
        <div class="product-card" onclick="showProductDetail(${product.id})">
            <div class="product-image">${product.image}</div>
            <div class="product-info">
                <div class="product-name">${product.nameEn}</div>
                <div class="product-description">${product.descriptionEn}</div>
                <div class="product-price">₹${product.price}/${product.unit}</div>
                <div class="product-meta">
                    <span>📦 ${product.quantity} ${product.unit} available</span>
                    <span>🏷️ ${product.category}</span>
                </div>
                <div class="product-seller">👤 ${product.seller.name}</div>
                <button class="add-to-cart-btn" onclick="event.stopPropagation(); addToCart(${product.id})">
                    Add to Cart
                </button>
            </div>
        </div>
    `).join('');
}

function filterProducts() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const category = document.getElementById('categoryFilter').value;
    
    allProducts = mockProducts.filter(product => {
        const matchesSearch = product.nameEn.toLowerCase().includes(searchTerm) || 
                            product.descriptionEn.toLowerCase().includes(searchTerm);
        const matchesCategory = !category || product.category === category;
        
        return matchesSearch && matchesCategory;
    });
    
    loadProducts();
}

// Product Detail
function showProductDetail(productId) {
    const product = mockProducts.find(p => p.id === productId);
    if (!product) return;
    
    const modal = document.getElementById('productModal');
    const detail = document.getElementById('productDetail');
    
    detail.innerHTML = `
        <div class="product-detail-image">${product.image}</div>
        <div class="detail-section">
            <h2>${product.nameEn}</h2>
            <p style="color: #888; font-size: 0.9rem;">${product.name}</p>
        </div>
        <div class="detail-section">
            <h3 style="color: #667eea;">₹${product.price}/${product.unit}</h3>
        </div>
        <div class="detail-section">
            <h3>Description</h3>
            <p>${product.descriptionEn}</p>
            <p style="color: #888; font-size: 0.9rem;">${product.description}</p>
        </div>
        <div class="detail-section">
            <h3>Seller Information</h3>
            <p>👤 ${product.seller.name}</p>
            <p>📞 ${product.seller.phone}</p>
            <p>📱 Added via: ${product.addedVia}</p>
        </div>
        <div class="detail-section">
            <h3>Availability</h3>
            <p>📦 ${product.quantity} ${product.unit} in stock</p>
            <p>🏷️ Category: ${product.category}</p>
        </div>
        <div class="quantity-selector">
            <button class="quantity-btn" onclick="changeQuantity(-1)">-</button>
            <input type="number" id="quantityInput" value="1" min="1" max="${product.quantity}" />
            <button class="quantity-btn" onclick="changeQuantity(1)">+</button>
        </div>
        <button class="add-to-cart-btn" onclick="addToCartWithQuantity(${product.id})">
            Add to Cart
        </button>
    `;
    
    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('productModal').classList.remove('active');
}

function changeQuantity(delta) {
    const input = document.getElementById('quantityInput');
    const newValue = parseInt(input.value) + delta;
    const max = parseInt(input.max);
    
    if (newValue >= 1 && newValue <= max) {
        input.value = newValue;
    }
}

// Cart
function addToCart(productId) {
    addToCartWithQuantity(productId, 1);
}

function addToCartWithQuantity(productId, quantity = null) {
    const product = mockProducts.find(p => p.id === productId);
    if (!product) return;
    
    const qty = quantity || parseInt(document.getElementById('quantityInput')?.value || 1);
    
    const existingItem = cart.find(item => item.productId === productId);
    
    if (existingItem) {
        existingItem.quantity += qty;
    } else {
        cart.push({
            productId: product.id,
            name: product.nameEn,
            price: product.price,
            unit: product.unit,
            quantity: qty,
            seller: product.seller.name
        });
    }
    
    saveCart();
    updateCartCount();
    closeModal();
    
    // Show feedback
    alert(`Added ${qty} ${product.unit} of ${product.nameEn} to cart!`);
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.productId !== productId);
    saveCart();
    updateCartCount();
    showCart();
}

function updateCartCount() {
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    document.getElementById('cartCount').textContent = count;
}

function saveCart() {
    localStorage.setItem('cart', JSON.stringify(cart));
}

function showCart() {
    const modal = document.getElementById('cartModal');
    const cartItems = document.getElementById('cartItems');
    
    if (cart.length === 0) {
        cartItems.innerHTML = '<div class="empty-message">Your cart is empty</div>';
        document.getElementById('cartTotal').textContent = '0';
    } else {
        cartItems.innerHTML = cart.map(item => `
            <div class="cart-item">
                <div class="cart-item-info">
                    <div class="cart-item-name">${item.name}</div>
                    <div class="cart-item-price">₹${item.price} × ${item.quantity} ${item.unit} = ₹${item.price * item.quantity}</div>
                    <div style="color: #888; font-size: 0.85rem;">Seller: ${item.seller}</div>
                </div>
                <div class="cart-item-actions">
                    <button class="remove-btn" onclick="removeFromCart(${item.productId})">Remove</button>
                </div>
            </div>
        `).join('');
        
        const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        document.getElementById('cartTotal').textContent = total;
    }
    
    modal.classList.add('active');
}

function closeCart() {
    document.getElementById('cartModal').classList.remove('active');
}

function checkout() {
    if (cart.length === 0) {
        alert('Your cart is empty!');
        return;
    }
    
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    const orderSummary = cart.map(item => 
        `${item.name} - ${item.quantity} ${item.unit} @ ₹${item.price} = ₹${item.price * item.quantity}`
    ).join('\n');
    
    alert(`Order Summary:\n\n${orderSummary}\n\nTotal Items: ${itemCount}\nTotal Amount: ₹${total}\n\nThank you for your order!\nThe sellers will contact you soon on ${currentBuyer.phone}`);
    
    // Clear cart
    cart = [];
    saveCart();
    updateCartCount();
    closeCart();
}

// Close modals on outside click
window.onclick = function(event) {
    const productModal = document.getElementById('productModal');
    const cartModal = document.getElementById('cartModal');
    
    if (event.target === productModal) {
        closeModal();
    }
    if (event.target === cartModal) {
        closeCart();
    }
}
