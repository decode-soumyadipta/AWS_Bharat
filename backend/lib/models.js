/**
 * Data models and validation utilities for marketplace
 */

/**
 * Product model
 */
class Product {
    constructor(data) {
        this.productId = data.productId;
        this.name = data.name;
        this.price = data.price;
        this.quantity = data.quantity;
        this.unit = data.unit;
        this.category = data.category;
        this.description = data.description || '';
        this.imageUrl = data.imageUrl || '';
        this.seller = data.seller;
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();
    }

    validate() {
        const errors = [];

        if (!this.productId) errors.push('productId is required');
        if (!this.name) errors.push('name is required');
        if (typeof this.price !== 'number' || this.price <= 0) {
            errors.push('price must be a positive number');
        }
        if (typeof this.quantity !== 'number' || this.quantity < 0) {
            errors.push('quantity must be a non-negative number');
        }
        if (!this.unit) errors.push('unit is required');
        if (!this.category) errors.push('category is required');
        if (!this.seller || !this.seller.name || !this.seller.phone) {
            errors.push('seller information (name and phone) is required');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    toJSON() {
        return {
            productId: this.productId,
            name: this.name,
            price: this.price,
            quantity: this.quantity,
            unit: this.unit,
            category: this.category,
            description: this.description,
            imageUrl: this.imageUrl,
            seller: this.seller,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}

/**
 * Address model with validation
 */
class Address {
    constructor(data) {
        this.name = data.name;
        this.phone = data.phone;
        this.street = data.street;
        this.city = data.city;
        this.state = data.state;
        this.postalCode = data.postalCode;
    }

    validate() {
        const errors = [];

        if (!this.name || this.name.trim() === '') {
            errors.push('name is required');
        }
        if (!this.phone || this.phone.trim() === '') {
            errors.push('phone is required');
        } else if (!this.validatePhone(this.phone)) {
            errors.push('phone must contain at least 10 digits');
        }
        if (!this.street || this.street.trim() === '') {
            errors.push('street is required');
        }
        if (!this.city || this.city.trim() === '') {
            errors.push('city is required');
        }
        if (!this.state || this.state.trim() === '') {
            errors.push('state is required');
        }
        if (!this.postalCode || this.postalCode.trim() === '') {
            errors.push('postalCode is required');
        } else if (!this.validatePostalCode(this.postalCode)) {
            errors.push('postalCode must be exactly 6 digits');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    validatePhone(phone) {
        const digits = phone.replace(/\D/g, '');
        return digits.length >= 10;
    }

    validatePostalCode(postalCode) {
        const digits = postalCode.replace(/\D/g, '');
        return digits.length === 6;
    }

    toJSON() {
        return {
            name: this.name,
            phone: this.phone,
            street: this.street,
            city: this.city,
            state: this.state,
            postalCode: this.postalCode
        };
    }
}

/**
 * Order model
 */
class Order {
    constructor(data) {
        this.buyer = data.buyer;
        this.items = data.items || [];
        this.totalAmount = data.totalAmount;
    }

    validate() {
        const errors = [];

        if (!this.buyer) {
            errors.push('buyer information is required');
        } else {
            const address = new Address(this.buyer.address || {});
            const addressValidation = address.validate();
            if (!addressValidation.valid) {
                errors.push(...addressValidation.errors.map(e => `buyer.address.${e}`));
            }
        }

        if (!this.items || this.items.length === 0) {
            errors.push('order must contain at least one item');
        }

        if (typeof this.totalAmount !== 'number' || this.totalAmount <= 0) {
            errors.push('totalAmount must be a positive number');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    formatWhatsAppMessage() {
        let message = '🛒 NEW ORDER\n\n';
        message += `Buyer: ${this.buyer.name}\n`;
        message += `Phone: ${this.buyer.phone}\n`;
        message += `Address: ${this.buyer.address.street}, ${this.buyer.address.city}, ${this.buyer.address.state} - ${this.buyer.address.postalCode}\n\n`;
        message += 'Items:\n';
        
        this.items.forEach(item => {
            const lineTotal = item.price * item.quantity;
            message += `- ${item.name} x ${item.quantity} @ ₹${item.price} = ₹${lineTotal}\n`;
        });
        
        message += `\nTotal Amount: ₹${this.totalAmount}\n\n`;
        message += `Please confirm order with buyer at ${this.buyer.phone}`;
        
        return message;
    }

    toJSON() {
        return {
            buyer: this.buyer,
            items: this.items,
            totalAmount: this.totalAmount
        };
    }
}

module.exports = {
    Product,
    Address,
    Order
};
