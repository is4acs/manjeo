import type {AddressCandidate, User} from '../lib/api.ts';

export type PromotionContext = { userId?: string; role?: string; restaurantId?: string; city: string; subtotal: number; delivery: number };
export type PromotionQuote = { context: string; promotion: { code: string; discount: number } };
export type LocationDraft = {address: string; city: string; details: string};
export type ProfileLocation = LocationDraft & {userId: string};
export type CustomerProfileDraft = LocationDraft & {name: string; phone: string; paymentMethod: 'demo' | 'stripe'};

export function customerProfileDraft(user: User): CustomerProfileDraft {
  return {name: user.name, phone: user.phone || '', address: user.deliveryAddress?.address || '',
    city: user.deliveryAddress?.city || 'Cayenne', details: user.deliveryAddress?.details || '', paymentMethod: user.paymentMethod || 'demo'};
}

/** A phone-only edit must not resend an unrelated or expired saved address. */
export function customerProfileChanges(draft: CustomerProfileDraft, user: User, language: string, proof: AddressCandidate | null): Record<string, unknown> {
  const current = customerProfileDraft(user);
  const changes: Record<string, unknown> = {};
  if (draft.name.trim() !== current.name) changes.name = draft.name.trim();
  if (draft.phone.trim() !== current.phone) changes.phone = draft.phone.trim();
  if (language !== user.language) changes.language = language;
  if (draft.paymentMethod !== current.paymentMethod) changes.paymentMethod = draft.paymentMethod;
  if (proof || draft.address.trim() !== current.address || draft.city !== current.city || draft.details.trim() !== current.details) {
    changes.deliveryAddress = !draft.address.trim() ? null : {address: draft.address.trim(), city: draft.city,
      details: draft.details.trim(), ...(proof ? {verificationToken: proof.verificationToken} : {})};
  }
  return changes;
}

/** A profile refresh may update an untouched destination, never a local edit.
 * A different account's saved address is adopted explicitly on account change.
 */
export function shouldAdoptProfileLocation(previous: ProfileLocation | null, next: ProfileLocation, draft: LocationDraft, hasSavedAddress: boolean): boolean {
  return !!(hasSavedAddress && previous?.userId !== next.userId || previous &&
    draft.address === previous.address && draft.city === previous.city && draft.details === previous.details);
}

// A quote belongs to one account and one price/destination snapshot, never to a mutable basket.
export function promotionContext(value: PromotionContext): string {
  if (value.role !== "client" || !value.userId || !value.restaurantId || !Number.isInteger(value.subtotal) || value.subtotal <= 0 || !Number.isInteger(value.delivery) || value.delivery < 0) return "";
  return JSON.stringify([value.userId, value.restaurantId, value.city, value.subtotal, value.delivery]);
}
export function quotedDiscount(quote: PromotionQuote | null, context: string, code: string, maximum: number): number {
  if (!context || !quote || quote.context !== context || quote.promotion.code !== code || !Number.isInteger(quote.promotion.discount) || quote.promotion.discount < 0) return 0;
  return Math.min(quote.promotion.discount, maximum);
}
