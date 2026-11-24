/**
 * Small JSON Schema subset validator used for plugin tool input/output and
 * manifest-declared MCP schemas. It intentionally supports a conservative set
 * of keywords and rejects schemas it cannot understand instead of silently
 * accepting data.
 */

export type JsonSchemaValidation = {
  ok: boolean;
  errors: string[];
};

const MAX_ERRORS = 20;
const MAX_DEPTH = 12;

function typeOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeOf(value) === 'object';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateJsonSchema(
  value: unknown,
  schema: unknown,
  path = '$'
): JsonSchemaValidation {
  const errors: string[] = [];

  const visit = (current: unknown, currentSchema: unknown, currentPath: string): void => {
    if (errors.length >= MAX_ERRORS) {
      return;
    }

    if (!isRecord(currentSchema)) {
      errors.push(`${currentPath}: schema must be an object.`);
      return;
    }

    const depth = currentPath.split('.').length;

    if (depth > MAX_DEPTH) {
      errors.push(`${currentPath}: schema is too deeply nested.`);
      return;
    }

    const enumValues = currentSchema.enum;

    if (enumValues !== undefined) {
      if (
        !Array.isArray(enumValues) ||
        !enumValues.some((entry) => JSON.stringify(entry) === JSON.stringify(current))
      ) {
        errors.push(`${currentPath}: value is not one of the allowed enum values.`);
      }
    }

    const type = currentSchema.type;

    if (type !== undefined) {
      const types = Array.isArray(type) ? type : [type];

      if (
        !types.every((entry) => typeof entry === 'string') ||
        !types.some((entry) => matchesType(current, entry as string))
      ) {
        errors.push(
          `${currentPath}: expected ${types.join(' or ')}, received ${typeOf(current)}.`
        );
        return;
      }
    }

    if (typeof current === 'string') {
      if (
        typeof currentSchema.minLength === 'number' &&
        current.length < currentSchema.minLength
      ) {
        errors.push(
          `${currentPath}: must be at least ${currentSchema.minLength} characters.`
        );
      }

      if (
        typeof currentSchema.maxLength === 'number' &&
        current.length > currentSchema.maxLength
      ) {
        errors.push(
          `${currentPath}: must be at most ${currentSchema.maxLength} characters.`
        );
      }

      if (typeof currentSchema.pattern === 'string') {
        try {
          if (!new RegExp(currentSchema.pattern).test(current)) {
            errors.push(`${currentPath}: does not match the required pattern.`);
          }
        } catch {
          errors.push(`${currentPath}: schema pattern is invalid.`);
        }
      }
    }

    if (typeof current === 'number') {
      if (
        typeof currentSchema.minimum === 'number' &&
        current < currentSchema.minimum
      ) {
        errors.push(`${currentPath}: must be >= ${currentSchema.minimum}.`);
      }

      if (
        typeof currentSchema.maximum === 'number' &&
        current > currentSchema.maximum
      ) {
        errors.push(`${currentPath}: must be <= ${currentSchema.maximum}.`);
      }
    }

    if (Array.isArray(current)) {
      if (
        typeof currentSchema.minItems === 'number' &&
        current.length < currentSchema.minItems
      ) {
        errors.push(`${currentPath}: needs at least ${currentSchema.minItems} items.`);
      }

      if (
        typeof currentSchema.maxItems === 'number' &&
        current.length > currentSchema.maxItems
      ) {
        errors.push(`${currentPath}: allows at most ${currentSchema.maxItems} items.`);
      }

      if (currentSchema.items !== undefined) {
        current.forEach((entry, index) => {
          visit(entry, currentSchema.items, `${currentPath}[${index}]`);
        });
      }
    }

    if (isRecord(current)) {
      const properties = currentSchema.properties;

      if (properties !== undefined && !isRecord(properties)) {
        errors.push(`${currentPath}: properties must be an object.`);
        return;
      }

      const propertySchemas = isRecord(properties) ? properties : {};
      const required = currentSchema.required;

      if (required !== undefined) {
        if (
          !Array.isArray(required) ||
          !required.every((entry) => typeof entry === 'string')
        ) {
          errors.push(`${currentPath}: required must be an array of strings.`);
        } else {
          for (const key of required) {
            if (!(key in current)) {
              errors.push(`${currentPath}: missing required property "${key}".`);
            }
          }
        }
      }

      for (const [key, entry] of Object.entries(current)) {
        if (Object.prototype.hasOwnProperty.call(propertySchemas, key)) {
          visit(entry, propertySchemas[key], `${currentPath}.${key}`);
          continue;
        }

        if (currentSchema.additionalProperties === false) {
          errors.push(`${currentPath}: unexpected property "${key}".`);
          continue;
        }

        if (isRecord(currentSchema.additionalProperties)) {
          visit(entry, currentSchema.additionalProperties, `${currentPath}.${key}`);
        }
      }
    }

    if (Array.isArray(currentSchema.anyOf)) {
      const matches = currentSchema.anyOf.some(
        (candidate) => validateJsonSchema(current, candidate, currentPath).ok
      );

      if (!matches) {
        errors.push(`${currentPath}: does not match any allowed schema.`);
      }
    }
  };

  try {
    visit(value, schema, path);
  } catch (error) {
    errors.push(
      `${path}: schema validation failed (${error instanceof Error ? error.message : 'unknown error'}).`
    );
  }

  return { ok: errors.length === 0, errors };
}

export function validateObjectSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = '$'
): JsonSchemaValidation {
  return validateJsonSchema(value, schema, path);
}
