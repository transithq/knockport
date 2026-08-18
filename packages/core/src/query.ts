/**
 * Response body query engine — a faithful TS port of Bruno's `@usebruno/query`
 * (packages/bruno-query/src/index.ts). Same semantics, same edge cases, so the
 * response filter behaves identically to Bruno's response pane.
 *
 * Supported expressions:
 *   1. Dot navigation        `customer.orders.items.amount`
 *   2. Deep navigation `..`  `..items.amount`
 *   3. Array indexing        `..items[0].amount`
 *   4. Array filter `[?]`    `..items[?].amount` with a predicate fn or an
 *                            object predicate ({ id: 2, amount: 20 })
 *   5. Array map `[?]`       `..items[?].amount` with a mapper fn
 */

type PredicateOrMapper = ((obj: unknown) => unknown) | Record<string, unknown>;

/** Deeply flatten arrays; drop nullish entries; undefined when empty. */
function normalize(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const values: unknown[] = [];
  for (const item of value) {
    const normalized = normalize(item);
    if (normalized != null) {
      values.push(...(Array.isArray(normalized) ? normalized : [normalized]));
    }
  }
  return values.length ? values : undefined;
}

/**
 * Get the value of a prop from source. Arrays are mapped item-wise; when
 * `deep` is true the lookup recurses into nested objects (never re-entering
 * a value already returned for the prop).
 */
function getValue(source: unknown, prop: string, deep = false): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  let value: unknown;
  if (Array.isArray(source)) {
    value = source.map((item) => getValue(item, prop, deep));
  } else {
    const record = source as Record<string, unknown>;
    value = record[prop];
    if (deep) {
      const found: unknown[] = [value];
      for (const [key, item] of Object.entries(record)) {
        if (key !== prop && typeof item === "object" && item !== null) {
          found.push(getValue(record[key], prop, deep));
        }
      }
      value = found;
    }
  }
  return normalize(value);
}

/** Predicate that checks scalar properties for equality. */
function objectPredicate(obj: Record<string, unknown>): (item: unknown) => boolean {
  return (item) => {
    if (typeof item !== "object" || item === null) return false;
    const record = item as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (record[key] !== value) return false;
    }
    return true;
  };
}

/**
 * Apply a filter or map to an array (or single object). A boolean-true result
 * keeps the item; a non-boolean non-null result replaces it (map).
 */
function filterOrMap(source: unknown, funOrObj: PredicateOrMapper): unknown {
  const fun = typeof funOrObj === "object" ? objectPredicate(funOrObj) : funOrObj;
  const isArray = Array.isArray(source);
  const list = isArray ? (source as unknown[]) : [source];
  const result: unknown[] = [];
  for (const item of list) {
    if (item == null) continue;
    const value = (fun as (obj: unknown) => unknown)(item);
    if (value === true) {
      result.push(item);
    } else if (value != null && value !== false) {
      result.push(value);
    }
  }
  return normalize(isArray ? result : result[0]);
}

/**
 * Navigate a parsed JSON value by a dot-path expression with deep `..`
 * navigation, array indexing and `[?]` filter/map steps.
 */
export function query(source: unknown, path: string, ...fns: PredicateOrMapper[]): unknown {
  const paths = path
    .replace(/\s+/g, "")
    .split(/(\.{1,2}|\[\?\]|\[\d+\])/g)
    .filter((s) => s.length > 0)
    .map((str) => {
      const clean = str.replace(/\[|\]/g, "");
      const index = parseInt(clean, 10);
      return Number.isNaN(index) ? clean : index;
    });

  let value = source;
  let index = 0;
  let lookbehind: string | number = "";
  let funIndex = 0;

  while (value != null && index < paths.length) {
    const token = paths[index++];
    if (token === ".." || token === ".") {
      // navigation markers are no-ops
    } else if (token === "?") {
      const fun = fns[funIndex++];
      if (fun == null) throw new Error(`missing function for ${lookbehind}`);
      value = filterOrMap(value, fun);
    } else if (typeof token === "number") {
      value = normalize((value as unknown[])[token]);
    } else {
      value = getValue(value, token as string, lookbehind === "..");
    }
    lookbehind = token;
  }

  return value;
}