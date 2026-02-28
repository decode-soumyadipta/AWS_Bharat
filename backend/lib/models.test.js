/**
 * Unit and Property-Based Tests for Data Models
 * Feature: marketplace-buyer-interface
 */

const { Product, Address, Order } = require('./models');
const fc = require('fast-check');

describe('Address Model', () => {
  describe('Unit Tests', () => {
    it('should create a valid address with all required fields', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '9876543210',
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(address.name).toBe('Priya Sharma');
      expect(address.phone).toBe('9876543210');
      expect(address.street).toBe('123 MG Road');
      expect(address.city).toBe('Bangalore');
      expect(address.state).toBe('Karnataka');
      expect(address.postalCode).toBe('560001');
    });

    it('should fail validation when name is missing', () => {
      const addressData = {
        phone: '9876543210',
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('name is required');
    });

    it('should fail validation when name is empty string', () => {
      const addressData = {
        name: '   ',
        phone: '9876543210',
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('name is required');
    });

    it('should fail validation when phone is missing', () => {
      const addressData = {
        name: 'Priya Sharma',
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('phone is required');
    });

    it('should fail validation when phone has less than 10 digits', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '987654321', // Only 9 digits
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('phone must contain at least 10 digits');
    });

    it('should accept phone with exactly 10 digits', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '9876543210',
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(true);
    });

    it('should accept phone with more than 10 digits', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '+919876543210', // 12 digits with country code
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(true);
    });

    it('should accept phone with non-digit characters if it has 10+ digits', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '+91-987-654-3210',
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(true);
    });

    it('should fail validation when street is missing', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '9876543210',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('street is required');
    });

    it('should fail validation when city is missing', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '9876543210',
        street: '123 MG Road',
        state: 'Karnataka',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('city is required');
    });

    it('should fail validation when state is missing', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '9876543210',
        street: '123 MG Road',
        city: 'Bangalore',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('state is required');
    });

    it('should fail validation when postalCode is missing', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '9876543210',
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('postalCode is required');
    });

    it('should fail validation when postalCode has less than 6 digits', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '9876543210',
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '56001' // Only 5 digits
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('postalCode must be exactly 6 digits');
    });

    it('should fail validation when postalCode has more than 6 digits', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '9876543210',
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '5600011' // 7 digits
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('postalCode must be exactly 6 digits');
    });

    it('should accept postalCode with exactly 6 digits', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '9876543210',
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(true);
    });

    it('should serialize to JSON correctly', () => {
      const addressData = {
        name: 'Priya Sharma',
        phone: '9876543210',
        street: '123 MG Road',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '560001'
      };

      const address = new Address(addressData);
      const json = address.toJSON();

      expect(json).toEqual(addressData);
    });

    it('should collect multiple validation errors', () => {
      const addressData = {
        name: '',
        phone: '123', // Too short
        street: '',
        city: '',
        state: '',
        postalCode: '12345' // Too short
      };

      const address = new Address(addressData);
      const validation = address.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(1);
    });
  });

  describe('Property-Based Tests', () => {
    // Arbitraries for generating test data
    const nonEmptyString = (minLength, maxLength) => 
      fc.string({ minLength, maxLength })
        .filter(s => s.trim().length > 0);

    const validAddressArbitrary = () => fc.record({
      name: nonEmptyString(1, 100),
      phone: fc.integer({ min: 1000000000, max: 9999999999 }).map(String),
      street: nonEmptyString(1, 200),
      city: nonEmptyString(1, 50),
      state: nonEmptyString(1, 50),
      postalCode: fc.integer({ min: 100000, max: 999999 }).map(String)
    });

    /**
     * Property 16: Address Field Validation
     * Validates: Requirements 5.3
     */
    it('Property 16: should fail validation for any address with one or more missing required fields', () => {
      const requiredFields = ['name', 'phone', 'street', 'city', 'state', 'postalCode'];
      
      requiredFields.forEach(field => {
        fc.assert(
          fc.property(
            validAddressArbitrary(),
            (addressData) => {
              const incompleteData = { ...addressData };
              delete incompleteData[field];
              
              const address = new Address(incompleteData);
              const validation = address.validate();

              expect(validation.valid).toBe(false);
              expect(validation.errors.length).toBeGreaterThan(0);
            }
          ),
          { numRuns: 20 }
        );
      });
    });

    /**
     * Property 16: Address Field Validation (empty string variant)
     * Validates: Requirements 5.3
     */
    it('Property 16: should fail validation for any address with empty string required fields', () => {
      const requiredFields = ['name', 'phone', 'street', 'city', 'state', 'postalCode'];
      
      requiredFields.forEach(field => {
        fc.assert(
          fc.property(
            validAddressArbitrary(),
            (addressData) => {
              const incompleteData = { ...addressData, [field]: '   ' };
              
              const address = new Address(incompleteData);
              const validation = address.validate();

              expect(validation.valid).toBe(false);
              expect(validation.errors.length).toBeGreaterThan(0);
            }
          ),
          { numRuns: 20 }
        );
      });
    });

    /**
     * Property 17: Phone Number Validation
     * Validates: Requirements 5.4, 10.4
     */
    it('Property 17: should reject any phone number with fewer than 10 digits', () => {
      fc.assert(
        fc.property(
          validAddressArbitrary(),
          fc.string({ minLength: 1, maxLength: 9 }).filter(s => {
            const digits = s.replace(/\D/g, '');
            return digits.length < 10 && s.trim().length > 0;
          }),
          (addressData, invalidPhone) => {
            const address = new Address({ ...addressData, phone: invalidPhone });
            const validation = address.validate();

            expect(validation.valid).toBe(false);
            expect(validation.errors).toContain('phone must contain at least 10 digits');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 17: Phone Number Validation (valid phones)
     * Validates: Requirements 5.4, 10.4
     */
    it('Property 17: should accept any phone number with 10 or more digits', () => {
      fc.assert(
        fc.property(
          validAddressArbitrary(),
          fc.integer({ min: 10, max: 15 }),
          (addressData, digitCount) => {
            // Generate a phone with exactly digitCount digits
            const validPhone = '9'.repeat(digitCount);
            const address = new Address({ ...addressData, phone: validPhone });
            const validation = address.validate();

            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 17: Phone Number Validation (with formatting)
     * Validates: Requirements 5.4, 10.4
     */
    it('Property 17: should accept phone numbers with non-digit characters if they contain 10+ digits', () => {
      fc.assert(
        fc.property(
          validAddressArbitrary(),
          fc.constantFrom(
            '+91-9876543210',
            '+91 987 654 3210',
            '(987) 654-3210',
            '+919876543210',
            '9876543210123'
          ),
          (addressData, formattedPhone) => {
            const address = new Address({ ...addressData, phone: formattedPhone });
            const validation = address.validate();

            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property 18: Postal Code Validation
     * Validates: Requirements 5.5
     */
    it('Property 18: should reject any postal code that is not exactly 6 digits', () => {
      fc.assert(
        fc.property(
          validAddressArbitrary(),
          fc.oneof(
            fc.integer({ min: 0, max: 99999 }).map(String), // Less than 6 digits
            fc.integer({ min: 1000000, max: 9999999 }).map(String) // More than 6 digits
          ),
          (addressData, invalidPostalCode) => {
            const address = new Address({ ...addressData, postalCode: invalidPostalCode });
            const validation = address.validate();

            expect(validation.valid).toBe(false);
            expect(validation.errors).toContain('postalCode must be exactly 6 digits');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 18: Postal Code Validation (valid codes)
     * Validates: Requirements 5.5
     */
    it('Property 18: should accept any postal code with exactly 6 digits', () => {
      fc.assert(
        fc.property(
          validAddressArbitrary(),
          fc.integer({ min: 100000, max: 999999 }).map(String),
          (addressData, validPostalCode) => {
            const address = new Address({ ...addressData, postalCode: validPostalCode });
            const validation = address.validate();

            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Valid Addresses Always Pass Validation
     * Validates: Requirements 5.3, 5.4, 5.5
     */
    it('Property: should validate successfully for any address with all valid required fields', () => {
      fc.assert(
        fc.property(
          validAddressArbitrary(),
          (addressData) => {
            const address = new Address(addressData);
            const validation = address.validate();

            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Serialization Round Trip
     * Validates: Requirements 5.2
     */
    it('Property: should preserve all data through serialization round trip', () => {
      fc.assert(
        fc.property(
          validAddressArbitrary(),
          (addressData) => {
            const address1 = new Address(addressData);
            const json = address1.toJSON();
            const address2 = new Address(json);

            expect(address2.name).toBe(address1.name);
            expect(address2.phone).toBe(address1.phone);
            expect(address2.street).toBe(address1.street);
            expect(address2.city).toBe(address1.city);
            expect(address2.state).toBe(address1.state);
            expect(address2.postalCode).toBe(address1.postalCode);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

describe('Order Model', () => {
  describe('Unit Tests', () => {
    it('should create a valid order with all required fields', () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '+919876543210'
            }
          }
        ],
        totalAmount: 250
      };

      const order = new Order(orderData);
      const validation = order.validate();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(order.buyer.name).toBe('Priya Sharma');
      expect(order.items).toHaveLength(1);
      expect(order.totalAmount).toBe(250);
    });

    it('should fail validation when buyer information is missing', () => {
      const orderData = {
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '+919876543210'
            }
          }
        ],
        totalAmount: 250
      };

      const order = new Order(orderData);
      const validation = order.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('buyer information is required');
    });

    it('should fail validation when buyer address is invalid', () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '123', // Invalid phone
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '+919876543210'
            }
          }
        ],
        totalAmount: 250
      };

      const order = new Order(orderData);
      const validation = order.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('phone'))).toBe(true);
    });

    it('should fail validation when items array is empty', () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [],
        totalAmount: 0
      };

      const order = new Order(orderData);
      const validation = order.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('order must contain at least one item');
    });

    it('should fail validation when totalAmount is not positive', () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '+919876543210'
            }
          }
        ],
        totalAmount: -100
      };

      const order = new Order(orderData);
      const validation = order.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('totalAmount must be a positive number');
    });

    it('should format WhatsApp message correctly with single item', () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '+919876543210'
            }
          }
        ],
        totalAmount: 250
      };

      const order = new Order(orderData);
      const message = order.formatWhatsAppMessage();

      expect(message).toContain('🛒 NEW ORDER');
      expect(message).toContain('Buyer: Priya Sharma');
      expect(message).toContain('Phone: 9876543210');
      expect(message).toContain('Address: 123 MG Road, Bangalore, Karnataka - 560001');
      expect(message).toContain('Fresh Tomatoes x 5 @ ₹50 = ₹250');
      expect(message).toContain('Total Amount: ₹250');
      expect(message).toContain('Please confirm order with buyer at 9876543210');
    });

    it('should format WhatsApp message correctly with multiple items', () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '+919876543210'
            }
          },
          {
            productId: 'prod-456',
            name: 'Organic Potatoes',
            quantity: 10,
            price: 30,
            seller: {
              name: 'Ramesh Kumar',
              phone: '+919876543210'
            }
          }
        ],
        totalAmount: 550
      };

      const order = new Order(orderData);
      const message = order.formatWhatsAppMessage();

      expect(message).toContain('Fresh Tomatoes x 5 @ ₹50 = ₹250');
      expect(message).toContain('Organic Potatoes x 10 @ ₹30 = ₹300');
      expect(message).toContain('Total Amount: ₹550');
    });

    it('should serialize to JSON correctly', () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '+919876543210'
            }
          }
        ],
        totalAmount: 250
      };

      const order = new Order(orderData);
      const json = order.toJSON();

      expect(json).toEqual(orderData);
    });
  });

  describe('Property-Based Tests', () => {
    // Arbitraries for generating test data
    const nonEmptyString = (minLength, maxLength) => 
      fc.string({ minLength, maxLength })
        .filter(s => s.trim().length > 0);

    const validAddressArbitrary = () => fc.record({
      name: nonEmptyString(1, 100),
      phone: fc.integer({ min: 1000000000, max: 9999999999 }).map(String),
      street: nonEmptyString(1, 200),
      city: nonEmptyString(1, 50),
      state: nonEmptyString(1, 50),
      postalCode: fc.integer({ min: 100000, max: 999999 }).map(String)
    });

    const validOrderItemArbitrary = () => fc.record({
      productId: fc.uuid(),
      name: nonEmptyString(1, 100),
      quantity: fc.integer({ min: 1, max: 100 }),
      price: fc.integer({ min: 1, max: 10000 }),
      seller: fc.record({
        name: nonEmptyString(1, 50),
        phone: fc.integer({ min: 1000000000, max: 9999999999 }).map(String)
      })
    });

    const validOrderArbitrary = () => fc.record({
      buyer: fc.record({
        name: nonEmptyString(1, 100),
        phone: fc.integer({ min: 1000000000, max: 9999999999 }).map(String),
        address: validAddressArbitrary()
      }),
      items: fc.array(validOrderItemArbitrary(), { minLength: 1, maxLength: 10 }),
      totalAmount: fc.integer({ min: 1, max: 1000000 })
    });

    /**
     * Property 19: Order Request Construction
     * Validates: Requirements 6.1, 6.2
     */
    it('Property 19: should construct order with all required fields for any valid order data', () => {
      fc.assert(
        fc.property(
          validOrderArbitrary(),
          (orderData) => {
            const order = new Order(orderData);
            const json = order.toJSON();

            // All required fields must be present
            expect(json.buyer).toBeDefined();
            expect(json.buyer.name).toBeDefined();
            expect(json.buyer.phone).toBeDefined();
            expect(json.buyer.address).toBeDefined();
            expect(json.buyer.address.street).toBeDefined();
            expect(json.buyer.address.city).toBeDefined();
            expect(json.buyer.address.state).toBeDefined();
            expect(json.buyer.address.postalCode).toBeDefined();
            expect(json.items).toBeDefined();
            expect(json.items.length).toBeGreaterThan(0);
            expect(json.totalAmount).toBeDefined();

            // Each item must have required fields
            json.items.forEach(item => {
              expect(item.name).toBeDefined();
              expect(item.quantity).toBeDefined();
              expect(item.price).toBeDefined();
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 20: WhatsApp Message Formatting
     * Validates: Requirements 6.4
     */
    it('Property 20: should format WhatsApp message with all order details for any valid order', () => {
      fc.assert(
        fc.property(
          validOrderArbitrary(),
          (orderData) => {
            const order = new Order(orderData);
            const message = order.formatWhatsAppMessage();

            // Message must contain all required sections
            expect(message).toContain('🛒 NEW ORDER');
            expect(message).toContain(`Buyer: ${orderData.buyer.name}`);
            expect(message).toContain(`Phone: ${orderData.buyer.phone}`);
            expect(message).toContain(orderData.buyer.address.street);
            expect(message).toContain(orderData.buyer.address.city);
            expect(message).toContain(orderData.buyer.address.state);
            expect(message).toContain(orderData.buyer.address.postalCode);
            expect(message).toContain('Items:');
            expect(message).toContain(`Total Amount: ₹${orderData.totalAmount}`);
            expect(message).toContain('Please confirm order with buyer');

            // Each item must be in the message
            orderData.items.forEach(item => {
              expect(message).toContain(item.name);
              expect(message).toContain(`x ${item.quantity}`);
              expect(message).toContain(`₹${item.price}`);
              const lineTotal = item.price * item.quantity;
              expect(message).toContain(`₹${lineTotal}`);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Valid Orders Always Pass Validation
     * Validates: Requirements 6.1, 6.2
     */
    it('Property: should validate successfully for any order with all required fields', () => {
      fc.assert(
        fc.property(
          validOrderArbitrary(),
          (orderData) => {
            const order = new Order(orderData);
            const validation = order.validate();

            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Orders Without Buyer Fail Validation
     * Validates: Requirements 6.1
     */
    it('Property: should fail validation for any order without buyer information', () => {
      fc.assert(
        fc.property(
          validOrderArbitrary(),
          (orderData) => {
            const invalidData = { ...orderData, buyer: undefined };
            const order = new Order(invalidData);
            const validation = order.validate();

            expect(validation.valid).toBe(false);
            expect(validation.errors).toContain('buyer information is required');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Orders Without Items Fail Validation
     * Validates: Requirements 6.2
     */
    it('Property: should fail validation for any order with empty items array', () => {
      fc.assert(
        fc.property(
          validOrderArbitrary(),
          (orderData) => {
            const invalidData = { ...orderData, items: [] };
            const order = new Order(invalidData);
            const validation = order.validate();

            expect(validation.valid).toBe(false);
            expect(validation.errors).toContain('order must contain at least one item');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Orders With Non-Positive Total Fail Validation
     * Validates: Requirements 6.2
     */
    it('Property: should fail validation for any order with non-positive totalAmount', () => {
      fc.assert(
        fc.property(
          validOrderArbitrary(),
          fc.integer({ max: 0 }),
          (orderData, invalidTotal) => {
            const invalidData = { ...orderData, totalAmount: invalidTotal };
            const order = new Order(invalidData);
            const validation = order.validate();

            expect(validation.valid).toBe(false);
            expect(validation.errors).toContain('totalAmount must be a positive number');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Serialization Round Trip
     * Validates: Requirements 6.1, 6.2
     */
    it('Property: should preserve all data through serialization round trip', () => {
      fc.assert(
        fc.property(
          validOrderArbitrary(),
          (orderData) => {
            const order1 = new Order(orderData);
            const json = order1.toJSON();
            const order2 = new Order(json);

            expect(order2.buyer.name).toBe(order1.buyer.name);
            expect(order2.buyer.phone).toBe(order1.buyer.phone);
            expect(order2.items.length).toBe(order1.items.length);
            expect(order2.totalAmount).toBe(order1.totalAmount);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

describe('Product Model', () => {
  describe('Unit Tests', () => {
    it('should create a valid product with all required fields', () => {
      const productData = {
        productId: 'prod-123',
        name: 'Fresh Tomatoes',
        price: 50,
        quantity: 100,
        unit: 'kg',
        category: 'Vegetables',
        seller: {
          name: 'Ramesh Kumar',
          phone: '+919876543210'
        }
      };

      const product = new Product(productData);
      const validation = product.validate();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(product.productId).toBe('prod-123');
      expect(product.name).toBe('Fresh Tomatoes');
      expect(product.price).toBe(50);
      expect(product.quantity).toBe(100);
      expect(product.unit).toBe('kg');
      expect(product.category).toBe('Vegetables');
      expect(product.seller.name).toBe('Ramesh Kumar');
      expect(product.seller.phone).toBe('+919876543210');
    });

    it('should set default values for optional fields', () => {
      const productData = {
        productId: 'prod-123',
        name: 'Fresh Tomatoes',
        price: 50,
        quantity: 100,
        unit: 'kg',
        category: 'Vegetables',
        seller: {
          name: 'Ramesh Kumar',
          phone: '+919876543210'
        }
      };

      const product = new Product(productData);

      expect(product.description).toBe('');
      expect(product.imageUrl).toBe('');
      expect(product.createdAt).toBeDefined();
      expect(product.updatedAt).toBeDefined();
    });

    it('should fail validation when productId is missing', () => {
      const productData = {
        name: 'Fresh Tomatoes',
        price: 50,
        quantity: 100,
        unit: 'kg',
        category: 'Vegetables',
        seller: {
          name: 'Ramesh Kumar',
          phone: '+919876543210'
        }
      };

      const product = new Product(productData);
      const validation = product.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('productId is required');
    });

    it('should fail validation when name is missing', () => {
      const productData = {
        productId: 'prod-123',
        price: 50,
        quantity: 100,
        unit: 'kg',
        category: 'Vegetables',
        seller: {
          name: 'Ramesh Kumar',
          phone: '+919876543210'
        }
      };

      const product = new Product(productData);
      const validation = product.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('name is required');
    });

    it('should fail validation when price is not a positive number', () => {
      const productData = {
        productId: 'prod-123',
        name: 'Fresh Tomatoes',
        price: -10,
        quantity: 100,
        unit: 'kg',
        category: 'Vegetables',
        seller: {
          name: 'Ramesh Kumar',
          phone: '+919876543210'
        }
      };

      const product = new Product(productData);
      const validation = product.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('price must be a positive number');
    });

    it('should fail validation when quantity is negative', () => {
      const productData = {
        productId: 'prod-123',
        name: 'Fresh Tomatoes',
        price: 50,
        quantity: -5,
        unit: 'kg',
        category: 'Vegetables',
        seller: {
          name: 'Ramesh Kumar',
          phone: '+919876543210'
        }
      };

      const product = new Product(productData);
      const validation = product.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('quantity must be a non-negative number');
    });

    it('should fail validation when unit is missing', () => {
      const productData = {
        productId: 'prod-123',
        name: 'Fresh Tomatoes',
        price: 50,
        quantity: 100,
        category: 'Vegetables',
        seller: {
          name: 'Ramesh Kumar',
          phone: '+919876543210'
        }
      };

      const product = new Product(productData);
      const validation = product.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('unit is required');
    });

    it('should fail validation when category is missing', () => {
      const productData = {
        productId: 'prod-123',
        name: 'Fresh Tomatoes',
        price: 50,
        quantity: 100,
        unit: 'kg',
        seller: {
          name: 'Ramesh Kumar',
          phone: '+919876543210'
        }
      };

      const product = new Product(productData);
      const validation = product.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('category is required');
    });

    it('should fail validation when seller information is missing', () => {
      const productData = {
        productId: 'prod-123',
        name: 'Fresh Tomatoes',
        price: 50,
        quantity: 100,
        unit: 'kg',
        category: 'Vegetables'
      };

      const product = new Product(productData);
      const validation = product.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('seller information (name and phone) is required');
    });

    it('should fail validation when seller name is missing', () => {
      const productData = {
        productId: 'prod-123',
        name: 'Fresh Tomatoes',
        price: 50,
        quantity: 100,
        unit: 'kg',
        category: 'Vegetables',
        seller: {
          phone: '+919876543210'
        }
      };

      const product = new Product(productData);
      const validation = product.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('seller information (name and phone) is required');
    });

    it('should serialize to JSON correctly', () => {
      const productData = {
        productId: 'prod-123',
        name: 'Fresh Tomatoes',
        price: 50,
        quantity: 100,
        unit: 'kg',
        category: 'Vegetables',
        description: 'Fresh organic tomatoes',
        imageUrl: 'https://example.com/tomato.jpg',
        seller: {
          name: 'Ramesh Kumar',
          phone: '+919876543210'
        },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      };

      const product = new Product(productData);
      const json = product.toJSON();

      expect(json).toEqual(productData);
    });
  });

  describe('Property-Based Tests', () => {
    // Arbitraries for generating test data
    const validProductArbitrary = () => fc.record({
      productId: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 100 }),
      price: fc.integer({ min: 1, max: 100000 }),
      quantity: fc.integer({ min: 0, max: 1000 }),
      unit: fc.constantFrom('kg', 'piece', 'liter', 'dozen', 'gram'),
      category: fc.constantFrom('Vegetables', 'Fruits', 'Grains', 'Dairy', 'Spices'),
      description: fc.string({ maxLength: 500 }),
      imageUrl: fc.webUrl(),
      seller: fc.record({
        name: fc.string({ minLength: 1, maxLength: 50 }),
        phone: fc.string({ minLength: 10, maxLength: 15 })
      })
    });

    /**
     * Property 1: Product Display Completeness
     * Validates: Requirements 1.3, 8.4
     */
    it('Property 1: should include all required display fields for any valid product', () => {
      fc.assert(
        fc.property(
          validProductArbitrary(),
          (productData) => {
            const product = new Product(productData);
            const json = product.toJSON();

            // All required fields must be present
            expect(json.productId).toBeDefined();
            expect(json.name).toBeDefined();
            expect(json.price).toBeDefined();
            expect(json.quantity).toBeDefined();
            expect(json.unit).toBeDefined();
            expect(json.category).toBeDefined();
            expect(json.seller).toBeDefined();
            expect(json.seller.name).toBeDefined();
            expect(json.seller.phone).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Serialization Round Trip
     * Validates: Requirements 1.3, 8.4
     */
    it('Property: should preserve all data through serialization round trip', () => {
      fc.assert(
        fc.property(
          validProductArbitrary(),
          (productData) => {
            const product1 = new Product(productData);
            const json = product1.toJSON();
            const product2 = new Product(json);

            expect(product2.productId).toBe(product1.productId);
            expect(product2.name).toBe(product1.name);
            expect(product2.price).toBe(product1.price);
            expect(product2.quantity).toBe(product1.quantity);
            expect(product2.unit).toBe(product1.unit);
            expect(product2.category).toBe(product1.category);
            expect(product2.seller.name).toBe(product1.seller.name);
            expect(product2.seller.phone).toBe(product1.seller.phone);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Valid Products Always Pass Validation
     * Validates: Requirements 1.3, 8.4
     */
    it('Property: should validate successfully for any product with all required fields', () => {
      fc.assert(
        fc.property(
          validProductArbitrary(),
          (productData) => {
            const product = new Product(productData);
            const validation = product.validate();

            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Missing Required Fields Fail Validation
     * Validates: Requirements 1.3, 8.4
     */
    it('Property: should fail validation when any required field is missing', () => {
      const requiredFields = ['productId', 'name', 'price', 'quantity', 'unit', 'category', 'seller'];
      
      requiredFields.forEach(field => {
        fc.assert(
          fc.property(
            validProductArbitrary(),
            (productData) => {
              const incompleteData = { ...productData };
              delete incompleteData[field];
              
              const product = new Product(incompleteData);
              const validation = product.validate();

              expect(validation.valid).toBe(false);
              expect(validation.errors.length).toBeGreaterThan(0);
            }
          ),
          { numRuns: 20 }
        );
      });
    });

    /**
     * Property: Price Must Be Positive
     * Validates: Requirements 1.3, 8.4
     */
    it('Property: should fail validation for any non-positive price', () => {
      fc.assert(
        fc.property(
          validProductArbitrary(),
          fc.integer({ max: 0 }),
          (productData, invalidPrice) => {
            const product = new Product({ ...productData, price: invalidPrice });
            const validation = product.validate();

            expect(validation.valid).toBe(false);
            expect(validation.errors).toContain('price must be a positive number');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Quantity Must Be Non-Negative
     * Validates: Requirements 1.3, 8.4
     */
    it('Property: should fail validation for any negative quantity', () => {
      fc.assert(
        fc.property(
          validProductArbitrary(),
          fc.integer({ max: -1 }),
          (productData, invalidQuantity) => {
            const product = new Product({ ...productData, quantity: invalidQuantity });
            const validation = product.validate();

            expect(validation.valid).toBe(false);
            expect(validation.errors).toContain('quantity must be a non-negative number');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
