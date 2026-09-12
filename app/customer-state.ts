export type PromotionContext = { userId?: string; role?: string; restaurantId?: string; city: string; subtotal: number; delivery: number };
export type PromotionQuote = { context: string; promotion: { code: string; discount: number } };

// A quote belongs to one account and one price/destination snapshot, never to a mutable basket.
export function promotionContext(value: PromotionContext): string {
  if (value.role !== "client" || !value.userId || !value.restaurantId || !Number.isInteger(value.subtotal) || value.subtotal <= 0 || !Number.isInteger(value.delivery) || value.delivery < 0) return "";
  return JSON.stringify([value.userId, value.restaurantId, value.city, value.subtotal, value.delivery]);
}
export function quotedDiscount(quote: PromotionQuote | null, context: string, code: string, maximum: number): number {
  if (!context || !quote || quote.context !== context || quote.promotion.code !== code || !Number.isInteger(quote.promotion.discount) || quote.promotion.discount < 0) return 0;
  return Math.min(quote.promotion.discount, maximum);
}
