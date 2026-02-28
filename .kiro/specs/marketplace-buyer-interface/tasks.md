# Implementation Plan: Marketplace Buyer Interface

## Overview

This implementation plan breaks down the marketplace buyer interface into discrete coding tasks. The system uses vanilla JavaScript for the frontend, Node.js for AWS Lambda backend functions, DynamoDB for data storage, and WhatsApp Business API for order delivery. The implementation follows a bottom-up approach: data models → backend APIs → frontend components → integration → testing.

## Tasks

- [x] 1. Set up project structure and dependencies
  - Create directory structure: `/frontend`, `/backend/lambdas`, `/backend/lib`, `/tests`
  - Initialize package.json with dependencies: aws-sdk, axios, fast-check, jest
  - Configure Jest for unit and property-based testing
  - Create .env.example with required environment variables
  - _Requirements: All_

- [ ] 2. Implement data models and validation utilities
  - [x] 2.1 Create Product model with validation
    - Write Product class with schema validation
    - Implement validation for required fields (productId, name, price, quantity, unit, category, seller)
    - Add methods for serialization/deserialization
    - _Requirements: 1.3, 8.4_
  
  - [x] 2.2 Write property test for Product model
    - **Property 1: Product Display Completeness**
    - **Validates: Requirements 1.1, 1.3, 8.4**
  
  - [x] 2.3 Create Address model with validation
    - Write Address class with validation methods
    - Implement phone number validation (minimum 10 digits)
    - Implement postal code validation (exactly 6 digits)
    - Validate all required fields (name, phone, street, city, state, postalCode)
    - _Requirements: 5.2, 5.3, 5.4, 5.5_
  
  - [x] 2.4 Write property tests for Address validation
    - **Property 16: Address Field Validation**
    - **Property 17: Phone Number Validation**
    - **Property 18: Postal Code Validation**
    - **Validates: Requirements 5.3, 5.4, 5.5, 10.4**
  
  - [x] 2.5 Create Order model with construction logic
    - Write Order class that constructs order requests from buyer info and cart items
    - Implement order data validation
    - Add method to format order for WhatsApp message
    - _Requirements: 6.1, 6.2, 6.4_
  
  - [x] 2.6 Write property tests for Order model
    - **Property 19: Order Request Construction**
    - **Property 20: WhatsApp Message Formatting**
    - **Validates: Requirements 6.1, 6.2, 6.4**

- [ ] 3. Implement backend Lambda functions
  - [x] 3.1 Create GetProductsFunction Lambda
    - Write Lambda handler to scan DynamoDB Products table
    - Implement sorting by createdAt descending
    - Format response with all product fields
    - Add error handling for DynamoDB failures
    - _Requirements: 1.2, 1.7, 8.1, 8.2_
  
  - [x] 3.2 Write property test for product sorting
    - **Property 2: Product Sorting by Creation Date**
    - **Validates: Requirements 1.7**
  
  - [x] 3.3 Create SubmitOrderFunction Lambda
    - Write Lambda handler to process order submissions
    - Validate order data using Order model
    - Format WhatsApp message with order details
    - Integrate with WhatsApp Business API to send message
    - Implement retry logic (3 attempts with exponential backoff)
    - Add error handling and logging
    - _Requirements: 6.3, 6.4, 6.5, 6.7_
  
  - [x] 3.4 Write unit tests for SubmitOrderFunction
    - Test successful order submission
    - Test WhatsApp API failure handling
    - Test retry logic
    - Mock WhatsApp API and DynamoDB
    - _Requirements: 6.3, 6.5, 6.7_
  
  - [x] 3.5 Create API Gateway configuration
    - Define REST API with /products (GET) and /orders (POST) endpoints
    - Configure CORS for frontend access
    - Set up Lambda integrations
    - Add request/response transformations
    - _Requirements: All backend requirements_

- [x] 4. Checkpoint - Backend validation
  - Ensure all Lambda functions deploy successfully
  - Test API endpoints manually with curl or Postman
  - Verify DynamoDB connections work
  - Ask the user if questions arise

- [ ] 5. Implement frontend Shopping Cart component
  - [x] 5.1 Create ShoppingCart class with core operations
    - Implement addItem(productId, quantity) method
    - Implement removeItem(productId) method
    - Implement updateQuantity(productId, quantity) method
    - Implement getItems() and getTotalPrice() methods
    - Implement clear() method
    - _Requirements: 2.2, 2.8, 7.4, 7.5_
  
  - [x] 5.2 Write property tests for cart operations
    - **Property 4: Add to Cart Operation**
    - **Property 8: Remove from Cart Operation**
    - **Property 7: Cart Total Calculation**
    - **Validates: Requirements 2.2, 2.7, 2.8, 7.3, 7.5**
  
  - [x] 5.3 Implement cart persistence with localStorage
    - Write saveToStorage() method to persist cart to localStorage
    - Write loadFromStorage() method to restore cart from localStorage
    - Handle localStorage quota exceeded errors
    - _Requirements: 2.9_
  
  - [x] 5.4 Write property test for cart persistence
    - **Property 9: Cart Persistence Round Trip**
    - **Validates: Requirements 2.9**
  
  - [x] 5.5 Implement quantity validation logic
    - Validate quantity >= 1 (lower bound)
    - Validate quantity <= available stock (upper bound)
    - Prevent invalid quantity operations
    - _Requirements: 3.3, 3.4_
  
  - [x] 5.6 Write property tests for quantity validation
    - **Property 10: Quantity Lower Bound Validation**
    - **Property 11: Quantity Upper Bound Validation**
    - **Property 12: Quantity Preservation in Cart**
    - **Property 13: Cart Quantity Increment on Duplicate Add**
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.6**
  
  - [x] 5.7 Implement cart UI rendering
    - Create renderCart() function to display cart items
    - Display item name, quantity, unit price, line total, seller name
    - Show grand total for all items
    - Add "Remove" button for each item
    - Show "Proceed to Checkout" button when cart has items
    - Show empty cart message when cart is empty
    - _Requirements: 2.6, 7.1, 7.2, 7.3, 7.6, 7.7_
  
  - [x] 5.8 Write property tests for cart display
    - **Property 5: Cart Item Count Display**
    - **Property 6: Cart Item Display Completeness**
    - **Property 23: Checkout Button Conditional Display**
    - **Validates: Requirements 2.4, 2.6, 7.1, 7.2, 7.6**

- [ ] 6. Implement frontend Product Catalog component
  - [x] 6.1 Create ProductCatalog class with API integration
    - Write constructor and initialize container
    - Implement loadProducts() to fetch from API
    - Implement renderProducts() to display product grid
    - Add polling mechanism (every 5 seconds) for real-time updates
    - Handle empty catalog state
    - _Requirements: 1.1, 1.2, 1.6, 8.2, 8.3_
  
  - [x] 6.2 Implement product card rendering
    - Create renderProductCard() function
    - Display product image (400x400 minimum), name, price, quantity, category, seller
    - Add "Add to Cart" button to each card
    - Add "Buy Now" button to each card
    - Handle product click to show detail modal
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.1, 4.1_
  
  - [x] 6.3 Write property tests for product display
    - **Property 3: Add to Cart Button Presence**
    - **Property 14: Buy Now Button Presence**
    - **Validates: Requirements 2.1, 4.1**
  
  - [x] 6.4 Implement search and filter functionality
    - Write filterBySearch(searchTerm) method for real-time text filtering
    - Write filterByCategory(category) method for category filtering
    - Implement combined search and category filtering
    - Display "No products found" message when no matches
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  
  - [x] 6.5 Write property tests for search and filter
    - **Property 24: Search Filter Correctness**
    - **Property 25: Category Filter Correctness**
    - **Property 26: Combined Filter Correctness**
    - **Validates: Requirements 9.2, 9.4, 9.5**
  
  - [x] 6.6 Implement quantity selector component
    - Create quantity selector with increment/decrement buttons
    - Set default quantity to 1
    - Enforce minimum quantity of 1
    - Enforce maximum quantity based on available stock
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 7. Implement frontend Checkout component
  - [x] 7.1 Create CheckoutFlow class with address form
    - Write showAddressForm() to display address collection form
    - Create form fields: name, phone, street, city, state, postalCode
    - Implement validateAddress() with all validation rules
    - Display inline error messages for invalid fields
    - _Requirements: 5.1, 5.2, 5.3, 5.6_
  
  - [x] 7.2 Implement order summary display
    - Create showOrderSummary() function
    - Display all items with quantities, prices, and line totals
    - Display delivery address
    - Display seller information for each item
    - Display grand total
    - Add "Confirm Order" button
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  
  - [x] 7.3 Write property test for order summary
    - **Property 30: Order Summary Completeness**
    - **Validates: Requirements 12.1, 12.2, 12.3**
  
  - [x] 7.4 Implement order submission logic
    - Write submitOrder() method to call backend API
    - Handle successful order submission (clear cart, show confirmation)
    - Handle failed order submission (retain cart, show error)
    - Display order confirmation with success message
    - _Requirements: 6.5, 6.6, 6.7, 12.5, 12.6_
  
  - [x] 7.5 Write property tests for order submission
    - **Property 21: Cart Clearing After Successful Order**
    - **Property 22: Cart Retention on Order Failure**
    - **Validates: Requirements 6.6, 6.7**

- [ ] 8. Implement Buy Now flow
  - [x] 8.1 Create Buy Now handler
    - Write handleBuyNow() function to initiate direct purchase
    - Bypass cart and proceed directly to address collection
    - Use currently selected quantity for the product
    - Support single product purchase only
    - _Requirements: 4.2, 4.3, 4.4, 4.5_
  
  - [x] 8.2 Write property test for Buy Now flow
    - **Property 15: Buy Now Quantity Preservation**
    - **Validates: Requirements 4.4**
  
  - [x] 8.3 Write unit tests for Buy Now flow
    - Test Buy Now bypasses cart
    - Test quantity preservation
    - Test single product limitation
    - _Requirements: 4.2, 4.3, 4.5_

- [ ] 9. Implement Buyer Authentication component
  - [x] 9.1 Create BuyerAuth class with login screen
    - Write showLoginScreen() to display login form
    - Request buyer name and phone number
    - Implement validateLogin() to check required fields
    - Validate phone number (minimum 10 digits)
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  
  - [x] 9.2 Write property tests for login validation
    - **Property 27: Login Validation**
    - **Validates: Requirements 10.3**
  
  - [x] 9.3 Implement session management
    - Write saveSession() to store buyer info in localStorage
    - Write getSession() to retrieve buyer info
    - Write logout() to clear session and return to login
    - Display buyer name in header after login
    - _Requirements: 10.5, 10.6, 10.7_
  
  - [x] 9.4 Write property test for session storage
    - **Property 28: Session Storage After Login**
    - **Property 29: Buyer Name Display After Login**
    - **Validates: Requirements 10.5, 10.6**

- [ ] 10. Implement responsive design and styling
  - [x] 10.1 Create responsive CSS for product grid
    - Implement 1 column layout for mobile (< 768px)
    - Implement 2-3 column layout for tablet (768-1024px)
    - Implement 3-4 column layout for desktop (> 1024px)
    - _Requirements: 11.1, 11.2, 11.3_
  
  - [x] 10.2 Implement mobile-friendly touch targets
    - Ensure all buttons and interactive elements are minimum 44x44 pixels
    - Ensure text is readable without horizontal scrolling
    - _Requirements: 11.4, 11.5_
  
  - [x] 10.3 Create main stylesheet with Amazon-style design
    - Style product cards with images, borders, shadows
    - Style cart UI with item list and totals
    - Style checkout form with clear labels and error states
    - Style header with logo, search bar, cart icon, and user name
    - Add loading states and animations
    - _Requirements: 1.1, All UI requirements_

- [x] 11. Checkpoint - Frontend components validation
  - Test all components in isolation
  - Verify cart operations work correctly
  - Verify product display and filtering work
  - Verify checkout flow works end-to-end
  - Ensure all tests pass, ask the user if questions arise

- [ ] 12. Integration and wiring
  - [x] 12.1 Create main application entry point
    - Write index.html with semantic HTML structure
    - Create app.js to initialize all components
    - Wire ProductCatalog to ShoppingCart
    - Wire ShoppingCart to CheckoutFlow
    - Wire BuyerAuth to session management
    - Handle application state transitions
    - _Requirements: All_
  
  - [x] 12.2 Implement error handling and user feedback
    - Add toast notifications for success/error messages
    - Implement retry logic for API failures (3 retries with exponential backoff)
    - Handle network errors gracefully
    - Preserve user data on errors
    - Add loading spinners for async operations
    - _Requirements: 2.3, 5.6, 6.5, 6.7_
  
  - [x] 12.3 Implement cart icon with badge
    - Display cart icon in header
    - Show badge with total item count
    - Update badge when cart changes
    - Make cart icon clickable to open cart view
    - _Requirements: 2.4, 2.5_
  
  - [x] 12.4 Write integration tests for complete flows
    - Test browse → add to cart → checkout → order flow
    - Test browse → buy now → order flow
    - Test search and filter → add to cart flow
    - Test login → browse → purchase flow
    - Mock backend APIs
    - _Requirements: All_

- [ ] 13. Deploy infrastructure and configure services
  - [x] 13.1 Create DynamoDB tables
    - Create marketplace-products table with productId as partition key
    - Add GSI on category for filtering
    - Add GSI on createdAt for sorting
    - Configure read/write capacity or on-demand billing
    - _Requirements: 8.1, 8.5_
  
  - [x] 13.2 Deploy Lambda functions to AWS
    - Package Lambda functions with dependencies
    - Deploy GetProductsFunction and SubmitOrderFunction
    - Configure environment variables (DynamoDB table names, WhatsApp API credentials)
    - Set up IAM roles and permissions
    - Configure CloudWatch logging
    - _Requirements: All backend requirements_
  
  - [x] 13.3 Configure API Gateway
    - Deploy REST API with /products and /orders endpoints
    - Enable CORS for frontend domain
    - Configure request validation
    - Set up API keys or authentication if needed
    - Test endpoints with sample requests
    - _Requirements: All API requirements_
  
  - [x] 13.4 Set up S3 and CloudFront for frontend hosting
    - Create S3 bucket for static website hosting
    - Upload HTML, CSS, and JavaScript files
    - Configure CloudFront distribution
    - Set up custom domain if needed
    - Configure HTTPS with SSL certificate
    - _Requirements: All frontend requirements_
  
  - [x] 13.5 Configure WhatsApp Business API integration
    - Set up WhatsApp Business API credentials
    - Configure webhook endpoints if needed
    - Test message sending with sample orders
    - Implement rate limiting and error handling
    - _Requirements: 6.3, 6.4_

- [x] 14. Final checkpoint and end-to-end testing
  - Deploy complete system to staging environment
  - Test complete user flows from browser to WhatsApp delivery
  - Verify real-time product synchronization works
  - Test on multiple devices (mobile, tablet, desktop)
  - Verify all 30 correctness properties pass
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation uses vanilla JavaScript (frontend) and Node.js (backend)
- AWS services: Lambda, DynamoDB, API Gateway, S3, CloudFront
- Testing framework: Jest with fast-check for property-based testing
- All 30 correctness properties from the design document are covered in property test tasks
