import type { TransformStyleFunction } from 'maplibre-gl';

const ORDERED_COMPARISONS = new Set(['<', '<=', '>', '>=']);
const NULLABLE_NUMERIC_PROPERTIES = new Set(['admin_level', 'ref_length']);

type StyleObject = Record<string, unknown>;

function isStyleObject(value: unknown): value is StyleObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableNumericGet(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value[0] === 'get' &&
    typeof value[1] === 'string' &&
    NULLABLE_NUMERIC_PROPERTIES.has(value[1])
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function styleValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return (
    left.length === right.length &&
    left.every((child, index) => styleValuesEqual(child, right[index]))
  );
}

function nullableNumericOperand(value: unknown[]) {
  const [, left, right] = value;
  if (isNullableNumericGet(left) && isFiniteNumber(right)) return left;
  if (isNullableNumericGet(right) && isFiniteNumber(left)) return right;
  return null;
}

function isGuardedNullableNumericComparison(value: unknown[]) {
  if (value.length !== 3 || value[0] !== 'all') return false;
  const guard = value[1];
  const comparison = value[2];
  if (
    !Array.isArray(guard) ||
    !Array.isArray(comparison) ||
    typeof comparison[0] !== 'string' ||
    !ORDERED_COMPARISONS.has(comparison[0])
  ) {
    return false;
  }

  const operand = nullableNumericOperand(comparison);
  return (
    operand !== null &&
    guard.length === 3 &&
    guard[0] === '==' &&
    guard[2] === 'number' &&
    Array.isArray(guard[1]) &&
    guard[1].length === 2 &&
    guard[1][0] === 'typeof' &&
    styleValuesEqual(guard[1][1], operand)
  );
}

function guardNullableNumericComparison(value: unknown[]): unknown[] {
  const [operator] = value;
  if (typeof operator !== 'string' || !ORDERED_COMPARISONS.has(operator)) {
    return value;
  }

  const nullableOperand = nullableNumericOperand(value);

  if (!nullableOperand) return value;

  // MapLibre's ordered comparisons throw a runtime evaluation error when an
  // untyped `get` resolves to null. `all` evaluates left-to-right, so the
  // original comparison only runs when OpenFreeMap supplied a number. This
  // preserves the filter's exact meaning without coercing malformed values or
  // inventing a numeric fallback that could accidentally match a boundary.
  return ['all', ['==', ['typeof', nullableOperand], 'number'], value];
}

function sanitizeStyleValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (isGuardedNullableNumericComparison(value)) return value;

    let changed = false;
    const children = value.map((child) => {
      const sanitized = sanitizeStyleValue(child);
      if (sanitized !== child) changed = true;
      return sanitized;
    });
    const sanitizedChildren = changed ? children : value;
    return guardNullableNumericComparison(sanitizedChildren);
  }

  if (!isStyleObject(value)) return value;

  let changed = false;
  const entries = Object.entries(value).map(([key, child]) => {
    const sanitized = sanitizeStyleValue(child);
    if (sanitized !== child) changed = true;
    return [key, sanitized] as const;
  });
  return changed ? Object.fromEntries(entries) : value;
}

/**
 * Guards the nullable numeric filters in OpenFreeMap's Positron layers before
 * MapLibre compiles the fetched style.
 */
export const sanitizeOpenFreeMapStyle: TransformStyleFunction = (
  _previousStyle,
  nextStyle,
) => {
  let changed = false;
  const layers = nextStyle.layers.map((layer) => {
    const sanitized = sanitizeStyleValue(layer) as typeof layer;
    if (sanitized !== layer) changed = true;
    return sanitized;
  });

  return changed ? { ...nextStyle, layers } : nextStyle;
};
