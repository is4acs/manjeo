import {restoreOrderRequest, type OrderRequest} from '../lib/checkout-request.ts';
import type {CartLine} from '../lib/cart.ts';

type RequestStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const legacyKey = 'manjeo-request-v1';
export const orderRequestStorageKey = (userId: string) => `manjeo-request-v2:${encodeURIComponent(userId)}`;

export function readPendingOrder(storage: RequestStorage, userId: string) {
  if (!userId) return null;
  try {
    const stored = storage.getItem(orderRequestStorageKey(userId));
    if (stored) {
      const current = restoreOrderRequest(JSON.parse(stored), userId);
      if (current) return current;
    }
  } catch { /* An invalid account entry must not hide a valid legacy request. */ }
  try {
    const old = restoreOrderRequest(JSON.parse(storage.getItem(legacyKey) || 'null'), userId);
    if (old) {
      // Remove the old single-account slot only once the migration is durable.
      try {
        storage.setItem(orderRequestStorageKey(userId), JSON.stringify(old));
        storage.removeItem(legacyKey);
      } catch { /* Keep the valid legacy value and allow its in-memory retry. */ }
    }
    return old;
  } catch { return null; }
}

export function writePendingOrder(storage: RequestStorage, userId: string, request: OrderRequest<Record<string, unknown>>) {
  try { storage.setItem(orderRequestStorageKey(userId), JSON.stringify(request)); } catch { /* The in-memory request still supports a retry. */ }
}

export function clearPendingOrder(storage: RequestStorage, userId: string, requestId: string) {
  for (const key of [orderRequestStorageKey(userId), legacyKey]) {
    try {
      const stored = restoreOrderRequest(JSON.parse(storage.getItem(key) || 'null'), userId);
      if (stored?.id === requestId) storage.removeItem(key);
    } catch { /* Never let storage failure hide a server-confirmed order. */ }
  }
}

const selectionsKey = (selections: unknown) => Array.isArray(selections)
  ? JSON.stringify(selections.map(selection => {
    if (!selection || typeof selection.groupId !== 'string' || !Array.isArray(selection.choiceIds)) return null;
    return [selection.groupId, [...selection.choiceIds].sort()];
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))) : '';

/** A recovered order must not empty a basket that was changed in the meantime. */
export function orderMatchesCart(payload: Record<string, unknown>, cart: CartLine[]): boolean {
  const items = payload.items;
  if (!Array.isArray(items) || items.length !== cart.length || !cart.length) return false;
  const keys = (values: {productId: unknown; quantity: unknown; unitPrice: unknown; productVersion: unknown; selections: unknown}[]) => values.map(item =>
    JSON.stringify([item.productId, item.quantity, item.unitPrice, item.productVersion, selectionsKey(item.selections)])).sort();
  if (cart.some(line => line.restaurantId !== payload.restaurantId) || items.some(item => !item || typeof item !== 'object')) return false;
  return JSON.stringify(keys(items)) === JSON.stringify(keys(cart.map(line => ({...line, unitPrice: line.price}))));
}
