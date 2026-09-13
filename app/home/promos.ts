import type { Promo, Restaurant } from "@/lib/menu";

/** Groupe principal de la carte : le prix d’appel s’y lit, jamais dans les boissons. */
export function mainGroup(restaurant: Restaurant): string {
  const declared = restaurant.categories?.length ? restaurant.categories : [...new Set(restaurant.products.map(item => item.group))];
  return declared.find(group => restaurant.products.some(item => item.group === group && item.available && !item.archived)) || "";
}

/** Le plat le moins cher de la carte principale ; à défaut, le moins cher tout court. */
export function startingPrice(restaurant: Restaurant): number {
  const available = restaurant.products.filter(item => item.available && !item.archived);
  const group = mainGroup(restaurant);
  const dishes = group ? available.filter(item => item.group === group) : available;
  const prices = (dishes.length ? dishes : available).map(item => item.price);
  return prices.length ? Math.min(...prices) : restaurant.from;
}

const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);
const dayEnd = (day: string) => Date.parse(`${day}T23:59:59.999Z`);

/** Une offre expirée disparaît de la page : elle n’est jamais rendue puis masquée. */
export function promoRuns(promo: Promo, at: number): boolean {
  const start = dayStart(promo.startsAt), end = dayEnd(promo.endsAt);
  return Number.isFinite(start) && Number.isFinite(end) && start <= at && at <= end;
}

/** Une seule offre par restaurant : la mise en avant d’abord, sinon la première encore valable. */
export function restaurantPromo(restaurant: Restaurant, at: number): Promo | null {
  const running = (restaurant.promos || []).filter(promo => promoRuns(promo, at));
  return running.find(promo => promo.highlight) || running[0] || null;
}

export function promoIndex(restaurants: Restaurant[], at: number): Map<string, Promo> {
  const index = new Map<string, Promo>();
  for (const restaurant of restaurants) {
    const promo = restaurantPromo(restaurant, at);
    if (promo) index.set(restaurant.id, promo);
  }
  return index;
}

export type CallPrice = { price: number; previous: number | null };

/** Le prix barré n’apparaît que si la remise touche le plat le moins cher de la carte principale.
 * Un lot ou un article offert ne change pas le prix d’appel : ils s’annoncent par l’étiquette. */
export function callPrice(restaurant: Restaurant, promo: Promo | null): CallPrice {
  const price = startingPrice(restaurant);
  if (!promo || promo.kind !== "percent" || promo.scope !== mainGroup(restaurant)) return {price, previous: null};
  if (!Number.isInteger(promo.value) || promo.value < 1 || promo.value > 100) return {price, previous: null};
  const discounted = price - Math.floor(price * promo.value / 100);
  return discounted > 0 && discounted < price ? {price: discounted, previous: price} : {price, previous: null};
}
