# Vyapar Vaani Marketplace

A simple e-commerce marketplace website that displays products added by sellers through WhatsApp.

## Features

### Buyer Features
- **Mock Login**: Simple login with name and phone number
- **Product Browsing**: View all products added by sellers via WhatsApp
- **Search & Filter**: Search products by name and filter by category
- **Product Details**: View detailed information about each product including:
  - Product name (English and Hindi)
  - Description
  - Price and unit
  - Available quantity
  - Seller information
  - How it was added (WhatsApp Voice/Image)
- **Shopping Cart**: 
  - Add products to cart
  - Adjust quantities
  - View cart total
  - Remove items
- **Checkout**: Mock checkout process with order summary

### Product Information
All products shown are mock data representing items that sellers would add through WhatsApp:
- Products added via WhatsApp Voice messages
- Products added via WhatsApp Image uploads
- Each product shows seller name and contact
- Categories: Food, Grocery, Handicraft, Clothing, Other

## How to Run

1. Open `index.html` in a web browser
2. Enter your name and phone number to login as a buyer
3. Browse products, add to cart, and checkout

## File Structure

```
marketplace/
├── index.html      # Main HTML structure
├── styles.css      # Styling and responsive design
├── app.js          # JavaScript logic and mock data
└── README.md       # This file
```

## Mock Products

The marketplace includes 8 sample products:
1. Mango Pickle (आम का अचार) - Food
2. Handmade Dupatta (हस्तनिर्मित दुपट्टा) - Clothing
3. Fresh Milk (ताज़ा दूध) - Grocery
4. Clay Pots (मिट्टी के बर्तन) - Handicraft
5. Organic Honey (ऑर्गेनिक शहद) - Food
6. Hand-woven Carpet (हाथ से बुना कालीन) - Handicraft
7. Fresh Vegetables (ताज़ी सब्जियां) - Grocery
8. Embroidered Saree (कढ़ाई वाली साड़ी) - Clothing

## Technologies Used

- HTML5
- CSS3 (with Flexbox and Grid)
- Vanilla JavaScript
- LocalStorage for session persistence

## Future Enhancements

To connect with the actual backend:
1. Replace mock data with API calls to fetch products from DynamoDB
2. Implement real authentication
3. Connect checkout to order processing Lambda
4. Add real-time product updates
5. Integrate with WhatsApp Business API for order notifications
