# Voice-First Workflow Test Scenarios

## Test 1: Complete Order Flow (Happy Path)
**Steps:**
1. User says: "मैं 5 kg आम ₹100 प्रति किलो के भाव में बेचना चाहता हूँ"
2. System extracts: product=आम, price=100, quantity=5, unit=kg
3. System asks for photo (voice-only)
4. User sends photo
5. System shows confirmation with image, text, and buttons
6. User clicks "✅ स्वीकार करें" button
7. System confirms and creates catalog

**Expected:**
- All responses before confirmation are voice-only
- Final confirmation shows image + text + buttons + voice instructions
- No duplicate processing if user also says "confirm"

## Test 2: Missing Fields Flow
**Steps:**
1. User says: "मैं आम बेचना चाहता हूँ" (only product name)
2. System detects missing: price, quantity, unit
3. System asks for missing fields (voice-only)
4. User says: "₹100 प्रति किलो"
5. System detects missing: quantity
6. System asks for quantity (voice-only)
7. User says: "5 kg"
8. System has all fields, asks for photo (voice-only)

**Expected:**
- System NEVER asks for photo until ALL fields are complete
- Each missing field prompt is voice-only
- No "again selling food" message when filling missing fields

## Test 3: Product Switch Detection
**Steps:**
1. User says: "मैं आम बेचना चाहता हूँ"
2. System asks for price
3. User says: "मैं केला बेचना चाहता हूँ" (different product!)
4. System detects product switch
5. System shows buttons: "जारी रखें" / "नया ऑर्डर"

**Case 3a: User clicks "जारी रखें"**
- System continues with आम (original product)
- System asks for remaining fields

**Case 3b: User clicks "नया ऑर्डर"**
- System cancels आम order
- System starts new order with केला
- System asks for price, quantity, unit

**Expected:**
- Product switch is detected immediately
- Interactive buttons appear
- Both button responses work correctly

## Test 4: Price/Quantity Update During Confirmation
**Steps:**
1. User completes order and gets confirmation
2. User says: "कीमत 600 रुपये करें"
3. System updates price to 600
4. System regenerates confirmation with new price

**Expected:**
- Voice instructions show in confirmation message
- Price update works via voice
- Confirmation regenerates automatically

## Test 5: Duplicate Confirmation Handling
**Steps:**
1. User gets confirmation with buttons
2. User says "confirm" in voice
3. User clicks "✅ स्वीकार करें" button

**Expected:**
- If voice processed first: acknowledges politely
- If button processed first: voice message acknowledges without confusion
- No duplicate catalog creation
- No confusing "update product" questions

## Test 6: Contextual Response Control
**Steps:**
1. User creates first order: "मैं आम बेचना चाहता हूँ"
2. System asks for price
3. User provides: "₹100"
4. System should NOT say "फिर से food बेच रहे हैं"

**Expected:**
- Contextual response ONLY for truly new orders
- NOT shown when filling missing fields
- NOT shown when user just confirmed previous order

## Voice Instructions Test
**Check confirmation message includes:**
```
💬 आवाज़ में बोलें:
• कीमत बदलने के लिए: "कीमत 600 रुपये करें"
• मात्रा बदलने के लिए: "मात्रा 50 करें"
```

## All Features Checklist
- [x] Voice-only responses (except final confirmation)
- [x] Missing field validation before image request
- [x] Product switch detection with interactive buttons
- [x] Price/quantity update via voice
- [x] Duplicate confirmation handling
- [x] Contextual response control
- [x] Voice instructions in confirmation
- [x] Continue current / Start new order buttons
