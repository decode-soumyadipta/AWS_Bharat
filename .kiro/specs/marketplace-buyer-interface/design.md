# Design Document: Marketplace Buyer Interface

## Overview

The Marketplace Buyer Interface is a web-based e-commerce application that provides an Amazon-style shopping experience for buyers while integrating with a WhatsApp-based seller infrastructure. The system enables buyers to browse products with images, manage shopping carts, and complete purchases through a familiar web interface, while sellers continue to manage their inventory through WhatsApp and receive orders directly on WhatsApp.

### Key Design Goals

1. **Seamless Integration**: Bridge web-based buyer experience with WhatsApp-based seller operations
2. **Real-time Synchronization**: Ensure product catalog updates from WhatsApp appear immediately in the marketplace
3. **Familiar UX**: Provide an Amazon-like interface that buyers already understand
4. **Mobile-First**: Support buyers on any device with responsive design
5. **Simple Authentication**: Minimal friction buyer identification without complex account systems

### Technology Stack

- **Frontend**: Vanilla JavaScript with HTML5 and CSS3 (no framework dependencies)
- **Backend**: AWS Lambda functions with Node.js runtime
- **Database**: Amazon DynamoDB for product catalog and session storage
- **Messaging**: WhatsApp Business API for order delivery to sellers
- **Hosting**: Amazon S3 + CloudFront for static web hosting
- **API Gateway**: AWS API Gateway for backend API endpoints

## Architecture

### System Components

The system follows a serverless architecture with clear separation between presentation, business logic, and data layers:

```
┌─────────────────────────────────────────────────────────────┐
│                     Buyer Browser                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Marketplace Interface (HTML/CSS/JS)                 │   │
│  │  - Product Display                                   │   │
│  │  - Shopping Cart                                     │   │
│  │  - Checkout Flow                                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ HTTPS/REST API
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              AWS API Gateway                                 │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              AWS Lambda Functions                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Get Products │  │ Manage Cart  │  │ Submit Order │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Amazon DynamoDB                                 │
│  ┌──────────────┐  ┌──────────────┐                         │
│  │   Products   │  │  Cart Sessions│                        │
│  │    Table     │  │     Table     │                        │
│  └──────────────┘  └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│           WhatsApp Business API                              │
│           (Order Delivery to Sellers)                        │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Product Browsing**: Browser → API Gateway → Lambda (GetProducts) → DynamoDB → Response
2. **Add to Cart**: Browser → LocalStorage (client-side cart management)
3. **Checkout**: Browser → API Gateway → Lambda (SubmitOrder) → DynamoDB + WhatsApp API → Response
4. **Real-time Updates**: Browser polls API Gateway every 5 seconds for new products

## Components and Interfaces

### Frontend Components

#### 1. Product Catalog Component

**Responsibility**: Display products in a grid layout with images, prices, and actions

**Interface**:
```javascript
class ProductCatalog {
  constructor(containerId)
  async loadProducts()
  filterBySearch(searchTerm)
  filterByCategory(category)
  renderProducts(products)
}
```

**Key Methods**:
- `loadProducts()`: Fetches products from API and renders them
- `filterBySearch(searchTerm)`: Filters displayed products by name/description
- `filterByCategory(category)`: Filters products by category
- `renderProducts(products)`: Updates DOM with product cards

#### 2. Shopping Cart Component

**Responsibility**: Manage cart state and display cart contents

**Interface**:
```javascript
class ShoppingCart {
  constructor()
  addItem(productId, quantity)
  removeItem(productId)
  updateQuantity(productId, quantity)
  getItems()
  getTotalPrice()
  clear()
  saveToStorage()
  loadFromStorage()
}
```

**Storage**: Uses browser localStorage with key `marketplace_cart`

**Data Structure**:
```javascript
{
  items: [
    {
      productId: string,
      name: string,
      price: number,
      quantity: number,
      seller: string
    }
  ],
  buyerInfo: {
    name: string,
    phone: string
  }
}
```

#### 3. Checkout Component

**Responsibility**: Handle address collection and order submission

**Interface**:
```javascript
class CheckoutFlow {
  constructor(cart)
  showAddressForm()
  validateAddress(addressData)
  submitOrder(addressData)
  showConfirmation(orderDetails)
}
```

**Address Validation Rules**:
- All fields required: name, phone, street, city, state, postalCode
- Phone: minimum 10 digits
- Postal code: exactly 6 digits

#### 4. Authentication Component

**Responsibility**: Handle buyer login and session management

**Interface**:
```javascript
class BuyerAuth {
  constructor()
  showLoginScreen()
  validateLogin(name, phone)
  saveSession(buyerInfo)
  getSession()
  logout()
}
```

**Session Storage**: Uses localStorage with key `buyer_session`

### Backend API Endpoints

#### 1. GET /products

**Purpose**: Retrieve all products from catalog

**Response**:
```json
{
  "products": [
    {
      "productId": "string",
      "name": "string",
      "price": number,
      "quantity": number,
      "unit": "string",
      "category": "string",
      "description": "string",
      "imageUrl": "string",
      "seller": {
        "name": "string",
        "phone": "string"
      },
      "createdAt": "ISO8601 timestamp"
    }
  ]
}
```

#### 2. POST /orders

**Purpose**: Submit order and send to seller WhatsApp

**Request**:
```json
{
  "buyer": {
    "name": "string",
    "phone": "string",
    "address": {
      "street": "string",
      "city": "string",
      "state": "string",
      "postalCode": "string"
    }
  },
  "items": [
    {
      "productId": "string",
      "name": "string",
      "quantity": number,
      "price": number,
      "seller": {
        "name": "string",
        "phone": "string"
      }
    }
  ],
  "totalAmount": number
}
```

**Response**:
```json
{
  "success": boolean,
  "orderId": "string",
  "message": "string"
}
```

### Backend Lambda Functions

#### 1. GetProductsFunction

**Responsibility**: Query DynamoDB products table and return all products

**Implementation**:
- Scan DynamoDB Products table
- Sort by createdAt descending
- Return formatted product list

#### 2. SubmitOrderFunction

**Responsibility**: Process order and send to seller WhatsApp

**Implementation**:
- Validate order data
- Format WhatsApp message with order details
- Send message via WhatsApp Business API
- Return success/failure response

**WhatsApp Message Format**:
```
🛒 NEW ORDER

Buyer: [Name]
Phone: [Phone]
Address: [Street], [City], [State] - [PostalCode]

Items:
- [Product Name] x [Quantity] @ ₹[Price] = ₹[Total]
- [Product Name] x [Quantity] @ ₹[Price] = ₹[Total]

Total Amount: ₹[Total]

Please confirm order with buyer at [Phone]
```

## Data Models

### Product Model

**DynamoDB Table**: `marketplace-products`

**Schema**:
```javascript
{
  productId: string (Partition Key),
  name: string,
  price: number,
  quantity: number,
  unit: string,
  category: string,
  description: string,
  imageUrl: string,
  seller: {
    name: string,
    phone: string
  },
  createdAt: string (ISO8601),
  updatedAt: string (ISO8601)
}
```

**Indexes**:
- GSI on `category` for category filtering
- GSI on `createdAt` for sorting by newest

### Cart Session Model

**Storage**: Browser localStorage

**Schema**:
```javascript
{
  sessionId: string,
  buyer: {
    name: string,
    phone: string
  },
  items: [
    {
      productId: string,
      name: string,
      price: number,
      quantity: number,
      seller: {
        name: string,
        phone: string
      }
    }
  ],
  createdAt: string,
  updatedAt: string
}
```

### Order Model

**Note**: Orders are not persisted in this system. They are sent directly to seller WhatsApp. Future enhancement could add order history storage.



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Product Display Completeness

*For any* product in the catalog, the rendered product card must include the product image, name, price per unit, available quantity, category, and seller name.

**Validates: Requirements 1.1, 1.3, 8.4**

### Property 2: Product Sorting by Creation Date

*For any* list of products, the display function must return them sorted in descending order by createdAt with newest products first.

**Validates: Requirements 1.7**

### Property 3: Add to Cart Button Presence

*For any* product, the rendered product card must contain an "Add to Cart" button.

**Validates: Requirements 2.1**

### Property 4: Add to Cart Operation

*For any* product and valid quantity, adding the product to the cart must result in that product appearing in the cart with the specified quantity.

**Validates: Requirements 2.2**

### Property 5: Cart Item Count Display

*For any* cart state, the cart badge must display a count equal to the total number of items in the cart.

**Validates: Requirements 2.4**

### Property 6: Cart Item Display Completeness

*For any* item in the shopping cart, the rendered display must include the item's name, quantity, unit price, line total, and seller name.

**Validates: Requirements 2.6, 7.1, 7.2**

### Property 7: Cart Total Calculation

*For any* shopping cart contents, the calculated total price must equal the sum of all individual item line totals (quantity × unit price).

**Validates: Requirements 2.7, 7.3**

### Property 8: Remove from Cart Operation

*For any* item in the shopping cart, removing that item must result in it no longer appearing in the cart and the total being recalculated correctly.

**Validates: Requirements 2.8, 7.5**

### Property 9: Cart Persistence Round Trip

*For any* shopping cart state, saving to localStorage and then loading from localStorage must preserve all cart items with their quantities and properties.

**Validates: Requirements 2.9**

### Property 10: Quantity Lower Bound Validation

*For any* quantity input less than 1, the validation function must reject the input and prevent the operation.

**Validates: Requirements 3.3**

### Property 11: Quantity Upper Bound Validation

*For any* quantity input greater than the available stock for a product, the validation function must reject the input and prevent the operation.

**Validates: Requirements 3.4**

### Property 12: Quantity Preservation in Cart

*For any* product and specified quantity, adding the product to the cart must store exactly that quantity in the cart.

**Validates: Requirements 3.5**

### Property 13: Cart Quantity Increment on Duplicate Add

*For any* product already in the cart, adding the same product again must increment the existing quantity rather than creating a duplicate entry.

**Validates: Requirements 3.6**

### Property 14: Buy Now Button Presence

*For any* product display (card or detail view), the rendered output must contain a "Buy Now" button.

**Validates: Requirements 4.1**

### Property 15: Buy Now Quantity Preservation

*For any* selected quantity when Buy Now is initiated, the order must use exactly that quantity.

**Validates: Requirements 4.4**

### Property 16: Address Field Validation

*For any* address object with one or more missing required fields (name, phone, street, city, state, postalCode), the validation function must return false and prevent order submission.

**Validates: Requirements 5.3**

### Property 17: Phone Number Validation

*For any* phone number string containing fewer than 10 digits, the validation function must reject it.

**Validates: Requirements 5.4, 10.4**

### Property 18: Postal Code Validation

*For any* postal code string that is not exactly 6 digits, the validation function must reject it.

**Validates: Requirements 5.5**

### Property 19: Order Request Construction

*For any* valid order data (buyer info, items, address), the order request construction function must produce an object containing all required fields: buyer name, phone, delivery address, ordered items with quantities and prices, and total amount.

**Validates: Requirements 6.1, 6.2**

### Property 20: WhatsApp Message Formatting

*For any* order request, the formatted WhatsApp message must contain all order details in a readable structure including buyer info, address, itemized list with prices, and total amount.

**Validates: Requirements 6.4**

### Property 21: Cart Clearing After Successful Order

*For any* successful order submission, the shopping cart must be empty after the operation completes.

**Validates: Requirements 6.6**

### Property 22: Cart Retention on Order Failure

*For any* failed order submission, the shopping cart contents must remain unchanged.

**Validates: Requirements 6.7**

### Property 23: Checkout Button Conditional Display

*For any* non-empty shopping cart, the rendered cart view must include a "Proceed to Checkout" button.

**Validates: Requirements 7.6**

### Property 24: Search Filter Correctness

*For any* search term and product list, the filtered results must only include products whose name or description contains the search term (case-insensitive).

**Validates: Requirements 9.2**

### Property 25: Category Filter Correctness

*For any* selected category and product list, the filtered results must only include products that belong to that category.

**Validates: Requirements 9.4**

### Property 26: Combined Filter Correctness

*For any* search term and selected category, the filtered results must include only products that match both the search term (in name or description) and belong to the selected category.

**Validates: Requirements 9.5**

### Property 27: Login Validation

*For any* login attempt with missing name or missing phone number, the validation function must reject the login and prevent access.

**Validates: Requirements 10.3**

### Property 28: Session Storage After Login

*For any* successful login with valid name and phone, the buyer information must be stored in the session (localStorage).

**Validates: Requirements 10.5**

### Property 29: Buyer Name Display After Login

*For any* logged-in session, the header display function must include the buyer's name from the session.

**Validates: Requirements 10.6**

### Property 30: Order Summary Completeness

*For any* checkout state, the order summary display must include all items with quantities and prices, the total amount, the delivery address, and seller information for each item.

**Validates: Requirements 12.1, 12.2, 12.3**

## Error Handling

### Client-Side Error Handling

**Validation Errors**:
- Display inline error messages for invalid form inputs
- Prevent form submission until all validation passes
- Highlight invalid fields with red borders and error text

**Network Errors**:
- Display user-friendly error messages for API failures
- Implement retry logic for transient failures (3 retries with exponential backoff)
- Preserve user data (cart, form inputs) when errors occur

**Storage Errors**:
- Handle localStorage quota exceeded errors gracefully
- Fall back to session-only cart if localStorage is unavailable
- Warn users about data loss on browser close if localStorage fails

### Backend Error Handling

**Lambda Function Errors**:
- Return structured error responses with HTTP status codes
- Log all errors to CloudWatch for debugging
- Implement circuit breaker pattern for WhatsApp API calls

**DynamoDB Errors**:
- Handle throttling with exponential backoff
- Return appropriate error messages for data access failures
- Implement read/write capacity monitoring and alarms

**WhatsApp API Errors**:
- Retry failed message sends up to 3 times
- Log failed orders for manual processing
- Return clear error messages to buyers when order submission fails
- Store failed orders in a dead-letter queue for later retry

### Error Response Format

All API errors follow this structure:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  }
}
```

## Testing Strategy

### Dual Testing Approach

This feature requires both unit testing and property-based testing to ensure comprehensive correctness:

**Unit Tests**: Focus on specific examples, edge cases, and integration points
- Example: Empty cart displays correct message
- Example: Login screen appears on first visit
- Example: Buy Now flow bypasses cart
- Edge case: Empty product catalog
- Edge case: Empty cart state
- Edge case: No search results found

**Property-Based Tests**: Verify universal properties across all inputs
- All 30 correctness properties defined above
- Each property test runs with minimum 100 iterations
- Tests use randomized inputs to discover edge cases

### Property-Based Testing Configuration

**Library**: Use `fast-check` for JavaScript property-based testing

**Test Structure**:
```javascript
// Example property test
test('Property 7: Cart Total Calculation', () => {
  fc.assert(
    fc.property(
      fc.array(cartItemArbitrary()),
      (items) => {
        const cart = new ShoppingCart();
        items.forEach(item => cart.addItem(item.productId, item.quantity));
        
        const expectedTotal = items.reduce(
          (sum, item) => sum + (item.price * item.quantity),
          0
        );
        
        expect(cart.getTotalPrice()).toBe(expectedTotal);
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: marketplace-buyer-interface, Property 7: Cart total calculation
```

**Tagging Convention**: Each property test must include a comment with:
```javascript
// Feature: marketplace-buyer-interface, Property {number}: {property description}
```

### Test Coverage Goals

- **Unit Test Coverage**: Minimum 80% code coverage
- **Property Test Coverage**: All 30 correctness properties implemented
- **Integration Tests**: API endpoints, WhatsApp integration, DynamoDB operations
- **E2E Tests**: Complete user flows (browse → add to cart → checkout → order)

### Testing Tools

- **Unit Testing**: Jest
- **Property-Based Testing**: fast-check
- **E2E Testing**: Playwright or Cypress
- **API Testing**: Supertest
- **Mocking**: Jest mocks for AWS services and WhatsApp API

### Key Test Scenarios

1. **Happy Path**: Browse products → Add to cart → Checkout → Submit order
2. **Buy Now Path**: Browse products → Buy Now → Submit order
3. **Validation Failures**: Invalid phone, invalid postal code, missing fields
4. **Cart Operations**: Add, remove, update quantities, persist across sessions
5. **Search and Filter**: Text search, category filter, combined filters
6. **Error Handling**: Network failures, API errors, validation errors
7. **Authentication**: Login, logout, session persistence

### Mock Data Strategy

**Product Generators**:
```javascript
const productArbitrary = () => fc.record({
  productId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  price: fc.integer({ min: 1, max: 100000 }),
  quantity: fc.integer({ min: 0, max: 1000 }),
  unit: fc.constantFrom('kg', 'piece', 'liter', 'dozen'),
  category: fc.constantFrom('Vegetables', 'Fruits', 'Grains', 'Dairy'),
  description: fc.string({ maxLength: 500 }),
  imageUrl: fc.webUrl(),
  seller: fc.record({
    name: fc.string({ minLength: 1, maxLength: 50 }),
    phone: fc.string({ minLength: 10, maxLength: 15 })
  }),
  createdAt: fc.date().map(d => d.toISOString())
});
```

**Address Generators**:
```javascript
const addressArbitrary = () => fc.record({
  name: fc.string({ minLength: 1, maxLength: 100 }),
  phone: fc.string({ minLength: 10, maxLength: 15 }),
  street: fc.string({ minLength: 1, maxLength: 200 }),
  city: fc.string({ minLength: 1, maxLength: 50 }),
  state: fc.string({ minLength: 1, maxLength: 50 }),
  postalCode: fc.integer({ min: 100000, max: 999999 }).map(String)
});
```

This dual testing approach ensures both concrete correctness (unit tests) and universal correctness (property tests), providing comprehensive validation of the marketplace interface.

