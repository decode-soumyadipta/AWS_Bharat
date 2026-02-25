/**
 * ONDC Schema Validator
 * 
 * This module validates catalog objects and ONDC payloads against
 * Beckn Protocol v1.2.0 specifications.
 * 
 * Features:
 * - Validates catalog objects against on_search schema
 * - Validates context fields (domain, country, city, action, core_version)
 * - Validates mandatory fields presence
 * - Validates currency code (ISO 4217: INR)
 * - Validates GPS coordinate format (lat,long)
 * - Returns validation result with detailed error messages
 * 
 * Validates: Requirements 2.7, 4.7, 8.2, 8.5, 8.6, 8.7
 */

import { BecknCatalogItem, ONDCCatalogPayload } from '../models/catalog';

/**
 * Validation error details
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * ISO 4217 currency codes (currently only INR is supported)
 */
const VALID_CURRENCY_CODES = ['INR'];

/**
 * Valid ONDC domain values
 */
const VALID_DOMAINS = [
  'nic2004:52110', // Retail
  'nic2004:52220', // Food & Beverage
  'ONDC:RET10', // Grocery
  'ONDC:RET11', // F&B
  'ONDC:RET12', // Fashion
  'ONDC:RET13', // BPC (Beauty & Personal Care)
  'ONDC:RET14', // Electronics
  'ONDC:RET15', // Appliances
  'ONDC:RET16', // Home & Kitchen
];

/**
 * Valid country codes
 */
const VALID_COUNTRY_CODES = ['IND'];

/**
 * Valid Beckn Protocol core versions
 */
const VALID_CORE_VERSIONS = ['1.2.0'];

/**
 * Valid actions for on_search
 */
const VALID_ACTIONS = ['on_search'];

/**
 * Validate a Beckn catalog item
 */
export function validateCatalogItem(item: BecknCatalogItem): ValidationResult {
  const errors: ValidationError[] = [];

  // Validate mandatory fields
  if (!item.id) {
    errors.push({
      field: 'id',
      message: 'Item ID is required',
    });
  }

  // Validate descriptor
  if (!item.descriptor) {
    errors.push({
      field: 'descriptor',
      message: 'Descriptor is required',
    });
  } else {
    if (!item.descriptor.name) {
      errors.push({
        field: 'descriptor.name',
        message: 'Product name is required',
      });
    }

    if (!item.descriptor.short_desc) {
      errors.push({
        field: 'descriptor.short_desc',
        message: 'Short description is required',
      });
    }

    if (!item.descriptor.long_desc) {
      errors.push({
        field: 'descriptor.long_desc',
        message: 'Long description is required',
      });
    }

    if (!Array.isArray(item.descriptor.images)) {
      errors.push({
        field: 'descriptor.images',
        message: 'Images must be an array',
      });
    }
  }

  // Validate price
  if (!item.price) {
    errors.push({
      field: 'price',
      message: 'Price is required',
    });
  } else {
    // Validate currency code (ISO 4217)
    if (!item.price.currency) {
      errors.push({
        field: 'price.currency',
        message: 'Currency code is required',
      });
    } else if (!VALID_CURRENCY_CODES.includes(item.price.currency)) {
      errors.push({
        field: 'price.currency',
        message: `Invalid currency code. Must be one of: ${VALID_CURRENCY_CODES.join(', ')}`,
        value: item.price.currency,
      });
    }

    // Validate price value
    if (!item.price.value) {
      errors.push({
        field: 'price.value',
        message: 'Price value is required',
      });
    } else {
      // Validate decimal string format
      if (!/^\d+\.\d{2}$/.test(item.price.value)) {
        errors.push({
          field: 'price.value',
          message: 'Price value must be a decimal string with 2 decimal places (e.g., "200.00")',
          value: item.price.value,
        });
      }
    }
  }

  // Validate quantity
  if (!item.quantity) {
    errors.push({
      field: 'quantity',
      message: 'Quantity is required',
    });
  } else {
    if (!item.quantity.available) {
      errors.push({
        field: 'quantity.available',
        message: 'Available quantity is required',
      });
    } else if (typeof item.quantity.available.count !== 'number') {
      errors.push({
        field: 'quantity.available.count',
        message: 'Available count must be a number',
        value: item.quantity.available.count,
      });
    }

    if (!item.quantity.maximum) {
      errors.push({
        field: 'quantity.maximum',
        message: 'Maximum quantity is required',
      });
    } else if (typeof item.quantity.maximum.count !== 'number') {
      errors.push({
        field: 'quantity.maximum.count',
        message: 'Maximum count must be a number',
        value: item.quantity.maximum.count,
      });
    }
  }

  // Validate category_id
  if (!item.category_id) {
    errors.push({
      field: 'category_id',
      message: 'Category ID is required',
    });
  }

  // Validate fulfillment_id
  if (!item.fulfillment_id) {
    errors.push({
      field: 'fulfillment_id',
      message: 'Fulfillment ID is required',
    });
  }

  // Validate location_id
  if (!item.location_id) {
    errors.push({
      field: 'location_id',
      message: 'Location ID is required',
    });
  }

  // Validate time
  if (!item.time) {
    errors.push({
      field: 'time',
      message: 'Time is required',
    });
  } else {
    if (!item.time.label) {
      errors.push({
        field: 'time.label',
        message: 'Time label is required',
      });
    } else if (!['enable', 'disable'].includes(item.time.label)) {
      errors.push({
        field: 'time.label',
        message: 'Time label must be "enable" or "disable"',
        value: item.time.label,
      });
    }

    if (!item.time.timestamp) {
      errors.push({
        field: 'time.timestamp',
        message: 'Time timestamp is required',
      });
    } else {
      // Validate ISO 8601 format
      try {
        const date = new Date(item.time.timestamp);
        if (isNaN(date.getTime())) {
          errors.push({
            field: 'time.timestamp',
            message: 'Time timestamp must be in ISO 8601 format',
            value: item.time.timestamp,
          });
        }
      } catch (error) {
        errors.push({
          field: 'time.timestamp',
          message: 'Time timestamp must be in ISO 8601 format',
          value: item.time.timestamp,
        });
      }
    }
  }

  // Validate tags array
  if (!Array.isArray(item.tags)) {
    errors.push({
      field: 'tags',
      message: 'Tags must be an array',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate ONDC context fields
 */
export function validateContext(context: ONDCCatalogPayload['context']): ValidationResult {
  const errors: ValidationError[] = [];

  // Validate domain
  if (!context.domain) {
    errors.push({
      field: 'context.domain',
      message: 'Domain is required',
    });
  } else if (!VALID_DOMAINS.includes(context.domain)) {
    errors.push({
      field: 'context.domain',
      message: `Invalid domain. Must be one of: ${VALID_DOMAINS.join(', ')}`,
      value: context.domain,
    });
  }

  // Validate country
  if (!context.country) {
    errors.push({
      field: 'context.country',
      message: 'Country is required',
    });
  } else if (!VALID_COUNTRY_CODES.includes(context.country)) {
    errors.push({
      field: 'context.country',
      message: `Invalid country code. Must be one of: ${VALID_COUNTRY_CODES.join(', ')}`,
      value: context.country,
    });
  }

  // Validate city
  if (!context.city) {
    errors.push({
      field: 'context.city',
      message: 'City is required',
    });
  }

  // Validate action
  if (!context.action) {
    errors.push({
      field: 'context.action',
      message: 'Action is required',
    });
  } else if (!VALID_ACTIONS.includes(context.action)) {
    errors.push({
      field: 'context.action',
      message: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`,
      value: context.action,
    });
  }

  // Validate core_version
  if (!context.core_version) {
    errors.push({
      field: 'context.core_version',
      message: 'Core version is required',
    });
  } else if (!VALID_CORE_VERSIONS.includes(context.core_version)) {
    errors.push({
      field: 'context.core_version',
      message: `Invalid core version. Must be one of: ${VALID_CORE_VERSIONS.join(', ')}`,
      value: context.core_version,
    });
  }

  // Validate bap_id
  if (!context.bap_id) {
    errors.push({
      field: 'context.bap_id',
      message: 'BAP ID is required',
    });
  }

  // Validate bap_uri
  if (!context.bap_uri) {
    errors.push({
      field: 'context.bap_uri',
      message: 'BAP URI is required',
    });
  }

  // Validate bpp_id
  if (!context.bpp_id) {
    errors.push({
      field: 'context.bpp_id',
      message: 'BPP ID is required',
    });
  }

  // Validate bpp_uri
  if (!context.bpp_uri) {
    errors.push({
      field: 'context.bpp_uri',
      message: 'BPP URI is required',
    });
  }

  // Validate transaction_id (UUID format)
  if (!context.transaction_id) {
    errors.push({
      field: 'context.transaction_id',
      message: 'Transaction ID is required',
    });
  } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.transaction_id)) {
    errors.push({
      field: 'context.transaction_id',
      message: 'Transaction ID must be a valid UUID',
      value: context.transaction_id,
    });
  }

  // Validate message_id (UUID format)
  if (!context.message_id) {
    errors.push({
      field: 'context.message_id',
      message: 'Message ID is required',
    });
  } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.message_id)) {
    errors.push({
      field: 'context.message_id',
      message: 'Message ID must be a valid UUID',
      value: context.message_id,
    });
  }

  // Validate timestamp (ISO 8601 format)
  if (!context.timestamp) {
    errors.push({
      field: 'context.timestamp',
      message: 'Timestamp is required',
    });
  } else {
    try {
      const date = new Date(context.timestamp);
      if (isNaN(date.getTime())) {
        errors.push({
          field: 'context.timestamp',
          message: 'Timestamp must be in ISO 8601 format',
          value: context.timestamp,
        });
      }
    } catch (error) {
      errors.push({
        field: 'context.timestamp',
        message: 'Timestamp must be in ISO 8601 format',
        value: context.timestamp,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate GPS coordinate format (lat,long)
 */
export function validateGPSCoordinates(gps: string): ValidationResult {
  const errors: ValidationError[] = [];

  if (!gps) {
    errors.push({
      field: 'gps',
      message: 'GPS coordinates are required',
    });
    return { valid: false, errors };
  }

  // GPS format: "lat,long"
  const gpsPattern = /^-?\d+\.\d+,-?\d+\.\d+$/;
  if (!gpsPattern.test(gps)) {
    errors.push({
      field: 'gps',
      message: 'GPS coordinates must be in format "lat,long" (e.g., "28.6139,77.2090")',
      value: gps,
    });
    return { valid: false, errors };
  }

  // Parse and validate latitude and longitude ranges
  const [latStr, longStr] = gps.split(',');
  const lat = parseFloat(latStr);
  const long = parseFloat(longStr);

  if (lat < -90 || lat > 90) {
    errors.push({
      field: 'gps.latitude',
      message: 'Latitude must be between -90 and 90',
      value: lat,
    });
  }

  if (long < -180 || long > 180) {
    errors.push({
      field: 'gps.longitude',
      message: 'Longitude must be between -180 and 180',
      value: long,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate complete ONDC on_search payload
 */
export function validateONDCCatalogPayload(payload: ONDCCatalogPayload): ValidationResult {
  const errors: ValidationError[] = [];

  // Validate context
  const contextValidation = validateContext(payload.context);
  if (!contextValidation.valid) {
    errors.push(...contextValidation.errors);
  }

  // Validate message structure
  if (!payload.message) {
    errors.push({
      field: 'message',
      message: 'Message is required',
    });
    return { valid: false, errors };
  }

  if (!payload.message.catalog) {
    errors.push({
      field: 'message.catalog',
      message: 'Catalog is required',
    });
    return { valid: false, errors };
  }

  // Validate bpp/descriptor
  if (!payload.message.catalog['bpp/descriptor']) {
    errors.push({
      field: 'message.catalog.bpp/descriptor',
      message: 'BPP descriptor is required',
    });
  }

  // Validate bpp/providers
  if (!payload.message.catalog['bpp/providers']) {
    errors.push({
      field: 'message.catalog.bpp/providers',
      message: 'BPP providers are required',
    });
  } else if (!Array.isArray(payload.message.catalog['bpp/providers'])) {
    errors.push({
      field: 'message.catalog.bpp/providers',
      message: 'BPP providers must be an array',
    });
  } else {
    // Validate each provider
    payload.message.catalog['bpp/providers'].forEach((provider, providerIndex) => {
      if (!provider.id) {
        errors.push({
          field: `message.catalog.bpp/providers[${providerIndex}].id`,
          message: 'Provider ID is required',
        });
      }

      if (!provider.descriptor) {
        errors.push({
          field: `message.catalog.bpp/providers[${providerIndex}].descriptor`,
          message: 'Provider descriptor is required',
        });
      }

      // Validate locations
      if (!provider.locations || !Array.isArray(provider.locations)) {
        errors.push({
          field: `message.catalog.bpp/providers[${providerIndex}].locations`,
          message: 'Provider locations must be an array',
        });
      } else {
        provider.locations.forEach((location, locationIndex) => {
          if (!location.id) {
            errors.push({
              field: `message.catalog.bpp/providers[${providerIndex}].locations[${locationIndex}].id`,
              message: 'Location ID is required',
            });
          }

          // Validate GPS coordinates
          if (location.gps) {
            const gpsValidation = validateGPSCoordinates(location.gps);
            if (!gpsValidation.valid) {
              gpsValidation.errors.forEach((error) => {
                errors.push({
                  field: `message.catalog.bpp/providers[${providerIndex}].locations[${locationIndex}].${error.field}`,
                  message: error.message,
                  value: error.value,
                });
              });
            }
          }

          // Validate address
          if (!location.address) {
            errors.push({
              field: `message.catalog.bpp/providers[${providerIndex}].locations[${locationIndex}].address`,
              message: 'Location address is required',
            });
          }
        });
      }

      // Validate items
      if (!provider.items || !Array.isArray(provider.items)) {
        errors.push({
          field: `message.catalog.bpp/providers[${providerIndex}].items`,
          message: 'Provider items must be an array',
        });
      } else {
        provider.items.forEach((item, itemIndex) => {
          const itemValidation = validateCatalogItem(item);
          if (!itemValidation.valid) {
            itemValidation.errors.forEach((error) => {
              errors.push({
                field: `message.catalog.bpp/providers[${providerIndex}].items[${itemIndex}].${error.field}`,
                message: error.message,
                value: error.value,
              });
            });
          }
        });
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
