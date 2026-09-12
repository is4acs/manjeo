export type OrderRequest<T extends Record<string, unknown>> = {key: string; id: string; payload: T};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value: unknown, depth = 0): unknown {
  if (depth > 24) throw new TypeError('Order payload is too deeply nested');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], depth + 1)]));
  throw new TypeError('Order payload must contain JSON values');
}

function businessKey(userId: string, payload: Record<string, unknown>) {
  const business = Object.fromEntries(Object.entries(payload).filter(([name]) => name !== 'addressVerificationToken' && name !== 'useDefaultAddress'));
  return JSON.stringify(canonical({userId, payload: business}));
}

function hasConfirmation(payload: Record<string, unknown>) {
  const token = payload.addressVerificationToken;
  const saved = payload.useDefaultAddress;
  return (Object.hasOwn(payload, 'addressVerificationToken') && typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) && saved === undefined)
    || (token === undefined && Object.hasOwn(payload, 'useDefaultAddress') && saved === true);
}

function checkoutShape(payload: Record<string, unknown>) {
  return ['restaurantId', 'customerName', 'phone', 'address', 'city', 'details', 'notes'].every(field => typeof payload[field] === 'string')
    && Number.isSafeInteger(payload.expectedTotal) && Number(payload.expectedTotal) >= 0
    && ['demo', 'stripe'].includes(String(payload.paymentMethod))
    && (payload.promoCode === null || typeof payload.promoCode === 'string')
    && Array.isArray(payload.items) && payload.items.length > 0 && payload.items.length <= 50
    && payload.items.every(item => record(item) && typeof item.productId === 'string'
      && Number.isSafeInteger(item.quantity) && Number(item.quantity) > 0 && Number(item.quantity) <= 20
      && Number.isSafeInteger(item.unitPrice) && Number(item.unitPrice) >= 0
      && Number.isSafeInteger(item.productVersion) && Number(item.productVersion) > 0
      && Array.isArray(item.selections) && item.selections.every(selection => record(selection)
        && typeof selection.groupId === 'string' && Array.isArray(selection.choiceIds) && selection.choiceIds.every(choice => typeof choice === 'string')));
}

/** Read only the named account's own, internally consistent pending request. */
export function restoreOrderRequest(previous: unknown, userId: string): OrderRequest<Record<string, unknown>> | null {
  if (!userId || !record(previous) || !Object.hasOwn(previous, 'key') || !Object.hasOwn(previous, 'id')
      || !Object.hasOwn(previous, 'payload') || typeof previous.key !== 'string' || typeof previous.id !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(previous.id)
      || !record(previous.payload) || !hasConfirmation(previous.payload) || !checkoutShape(previous.payload)) return null;
  try {
    if (businessKey(userId, previous.payload) !== previous.key) return null;
    return {key: previous.key, id: previous.id, payload: JSON.parse(JSON.stringify(canonical(previous.payload)))};
  } catch { return null; }
}

/** Keep the first exact HTTP payload through an uncertain response or reload.
 * Saving the same address may switch its proof from a token to a saved default;
 * that alone must never create a second order or change an idempotent replay.
 */
export function prepareOrderRequest<T extends Record<string, unknown>>(
  previous: unknown, userId: string, payload: T, createId: () => string,
): OrderRequest<T> {
  if (!userId || typeof userId !== 'string') throw new TypeError('An account is required for an order');
  const key = businessKey(userId, payload);
  if (record(previous) && Object.hasOwn(previous, 'key') && Object.hasOwn(previous, 'id') && Object.hasOwn(previous, 'payload')
      && previous.key === key && typeof previous.id === 'string'
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(previous.id)
      && record(previous.payload) && hasConfirmation(previous.payload)) {
    try {
      // A sessionStorage value is data, even if its key claims to be current.
      // Check the actual stored business fields before reusing its identifier.
      if (businessKey(userId, previous.payload) === key) {
        return {key, id: previous.id, payload: JSON.parse(JSON.stringify(canonical(previous.payload))) as T};
      }
    } catch { /* Malformed, non-JSON or excessively nested cache: start afresh. */ }
  }
  return {key, id: createId(), payload: JSON.parse(JSON.stringify(canonical(payload))) as T};
}
