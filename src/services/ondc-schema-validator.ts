
import { BecknCatalogItem, ONDCCatalogPayload } from '../models/catalog';

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const VALID_CURRENCY_CODES = ['INR'];

const VALID_DOMAINS = [
  'nic2004:52110', 
  'nic2004:52220', 
  'ONDC:RET10', 
  'ONDC:RET11', 
  'ONDC:RET12', 
  'ONDC:RET13', 
  'ONDC:RET14', 
  'ONDC:RET15', 
  'ONDC:RET16', 
];

const VALID_COUNTRY_CODES = ['IND'];

const VALID_CORE_VERSIONS = ['1.2.0'];

const VALID_ACTIONS = ['on_search'];

export function validateCatalogItem(item: BecknCatalogItem): ValidationResult {
  const errors: ValidationError[] = [];

  if (!item.id) {
    errors.push({
      field: 'id',
      message: 'Item ID is required',
    });
  }

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

  if (!item.price) {
    errors.push({
      field: 'price',
      message: 'Price is required',
    });
  } else {

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

    if (!item.price.value) {
      errors.push({
        field: 'price.value',
        message: 'Price value is required',
      });
    } else {

      if (!/^\d+\.\d{2}$/.test(item.price.value)) {
        errors.push({
          field: 'price.value',
          message: 'Price value must be a decimal string with 2 decimal places (e.g., "200.00")',
          value: item.price.value,
        });
      }
    }
  }

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

  if (!item.category_id) {
    errors.push({
      field: 'category_id',
      message: 'Category ID is required',
    });
  }

  if (!item.fulfillment_id) {
    errors.push({
      field: 'fulfillment_id',
      message: 'Fulfillment ID is required',
    });
  }

  if (!item.location_id) {
    errors.push({
      field: 'location_id',
      message: 'Location ID is required',
    });
  }

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

export function validateContext(context: ONDCCatalogPayload['context']): ValidationResult {
  const errors: ValidationError[] = [];

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

  if (!context.city) {
    errors.push({
      field: 'context.city',
      message: 'City is required',
    });
  }

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

  if (!context.bap_id) {
    errors.push({
      field: 'context.bap_id',
      message: 'BAP ID is required',
    });
  }

  if (!context.bap_uri) {
    errors.push({
      field: 'context.bap_uri',
      message: 'BAP URI is required',
    });
  }

  if (!context.bpp_id) {
    errors.push({
      field: 'context.bpp_id',
      message: 'BPP ID is required',
    });
  }

  if (!context.bpp_uri) {
    errors.push({
      field: 'context.bpp_uri',
      message: 'BPP URI is required',
    });
  }

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

export function validateGPSCoordinates(gps: string): ValidationResult {
  const errors: ValidationError[] = [];

  if (!gps) {
    errors.push({
      field: 'gps',
      message: 'GPS coordinates are required',
    });
    return { valid: false, errors };
  }

  const gpsPattern = /^-?\d+\.\d+,-?\d+\.\d+$/;
  if (!gpsPattern.test(gps)) {
    errors.push({
      field: 'gps',
      message: 'GPS coordinates must be in format "lat,long" (e.g., "28.6139,77.2090")',
      value: gps,
    });
    return { valid: false, errors };
  }

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

export function validateONDCCatalogPayload(payload: ONDCCatalogPayload): ValidationResult {
  const errors: ValidationError[] = [];

  const contextValidation = validateContext(payload.context);
  if (!contextValidation.valid) {
    errors.push(...contextValidation.errors);
  }

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

  if (!payload.message.catalog['bpp/descriptor']) {
    errors.push({
      field: 'message.catalog.bpp/descriptor',
      message: 'BPP descriptor is required',
    });
  }

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

          if (!location.address) {
            errors.push({
              field: `message.catalog.bpp/providers[${providerIndex}].locations[${locationIndex}].address`,
              message: 'Location address is required',
            });
          }
        });
      }

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
