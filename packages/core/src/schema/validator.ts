import type { EnvSpecType } from "../types/schema";

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Validate a value against an @env-spec type definition.
 */
export function validateValue(value: string, type: EnvSpecType): ValidationResult {
  const validator = validators[type.name];
  if (!validator) {
    return { valid: true }; // Unknown types pass validation
  }
  return validator(value, type.params);
}

type Validator = (value: string, params: Record<string, string>) => ValidationResult;

const validators: Record<string, Validator> = {
  string: (value, params) => {
    if (params.minLength && value.length < parseInt(params.minLength, 10)) {
      return { valid: false, message: `Must be at least ${params.minLength} characters` };
    }
    if (params.maxLength && value.length > parseInt(params.maxLength, 10)) {
      return { valid: false, message: `Must be at most ${params.maxLength} characters` };
    }
    if (params.startsWith && !value.startsWith(params.startsWith)) {
      return { valid: false, message: `Must start with "${params.startsWith}"` };
    }
    if (params.endsWith && !value.endsWith(params.endsWith)) {
      return { valid: false, message: `Must end with "${params.endsWith}"` };
    }
    if (params.matches) {
      try {
        if (!new RegExp(params.matches).test(value)) {
          return { valid: false, message: `Must match pattern: ${params.matches}` };
        }
      } catch {
        // Invalid regex — skip validation
      }
    }
    return { valid: true };
  },

  number: (value, params) => {
    const num = parseFloat(value);
    if (Number.isNaN(num)) return { valid: false, message: "Must be a number" };
    if (params.min && num < parseFloat(params.min)) {
      return { valid: false, message: `Must be at least ${params.min}` };
    }
    if (params.max && num > parseFloat(params.max)) {
      return { valid: false, message: `Must be at most ${params.max}` };
    }
    if (params.isInt === "true" && !Number.isInteger(num)) {
      return { valid: false, message: "Must be an integer" };
    }
    return { valid: true };
  },

  boolean: (value) => {
    const valid = ["true", "false", "1", "0", "yes", "no"].includes(value.toLowerCase());
    return valid
      ? { valid: true }
      : { valid: false, message: "Must be a boolean (true/false/1/0/yes/no)" };
  },

  url: (value) => {
    try {
      new URL(value);
      return { valid: true };
    } catch {
      return { valid: false, message: "Must be a valid URL" };
    }
  },

  enum: (value, params) => {
    const allowed = Object.keys(params);
    if (allowed.includes(value)) return { valid: true };
    return {
      valid: false,
      message: `Must be one of: ${allowed.join(", ")}`,
    };
  },

  email: (value) => {
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    return valid ? { valid: true } : { valid: false, message: "Must be a valid email address" };
  },

  port: (value, params) => {
    const num = parseInt(value, 10);
    if (Number.isNaN(num) || num < 0 || num > 65535) {
      return { valid: false, message: "Must be a valid port number (0-65535)" };
    }
    if (params.min && num < parseInt(params.min, 10)) {
      return { valid: false, message: `Port must be at least ${params.min}` };
    }
    if (params.max && num > parseInt(params.max, 10)) {
      return { valid: false, message: `Port must be at most ${params.max}` };
    }
    return { valid: true };
  },

  ip: (value, params) => {
    const v4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
    const v6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(value);
    if (params.version === "4")
      return v4 ? { valid: true } : { valid: false, message: "Must be a valid IPv4 address" };
    if (params.version === "6")
      return v6 ? { valid: true } : { valid: false, message: "Must be a valid IPv6 address" };
    return v4 || v6 ? { valid: true } : { valid: false, message: "Must be a valid IP address" };
  },

  semver: (value) => {
    const valid = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(value);
    return valid
      ? { valid: true }
      : { valid: false, message: "Must be a valid semver (e.g., 1.2.3)" };
  },

  isoDate: (value) => {
    const d = new Date(value);
    return !Number.isNaN(d.getTime())
      ? { valid: true }
      : { valid: false, message: "Must be a valid ISO date" };
  },

  uuid: (value) => {
    const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    return valid ? { valid: true } : { valid: false, message: "Must be a valid UUID" };
  },

  md5: (value) => {
    const valid = /^[0-9a-f]{32}$/i.test(value);
    return valid
      ? { valid: true }
      : { valid: false, message: "Must be a valid MD5 hash (32 hex characters)" };
  },
};
