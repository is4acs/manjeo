/**
 * Les offres de l'accueil.
 *
 * Une étiquette d'offre n'est jamais composée par la page : elle vient d'un code
 * promotionnel que le serveur applique réellement au paiement (`server/promotions.py`).
 * Le prix barré suit la même règle — il n'apparaît que si la remise s'applique
 * vraiment à une commande d'un seul plat, minimum de commande compris.
 */
import { money, startingPrice, type Restaurant } from "./menu.ts";
import type { PublicPromotion } from "./api.ts";

export type StartingOffer = { price: number; previous: number };

/** Une offre par restaurant : seuls les codes réservés à une adresse font une étiquette. */
export function offersByRestaurant(promotions: PublicPromotion[]): Map<string, PublicPromotion> {
  const offers = new Map<string, PublicPromotion>();
  for (const promotion of promotions) {
    if (!promotion.restaurantId || offers.has(promotion.restaurantId)) continue;
    offers.set(promotion.restaurantId, promotion);
  }
  return offers;
}

/** Les codes valables partout : ce sont eux, et non les offres d'une adresse, qui font les bons plans. */
export function houseOffers(promotions: PublicPromotion[]): PublicPromotion[] {
  return promotions.filter(promotion => !promotion.restaurantId);
}

/**
 * La remise appliquée au plat le moins cher de la carte principale, ou `null`.
 * Le barème reproduit `discount_for` côté serveur ; une livraison offerte ne
 * change aucun prix de plat, et un minimum de commande non atteint non plus.
 */
export function startingOffer(restaurant: Restaurant, promotion?: PublicPromotion): StartingOffer | null {
  const previous = startingPrice(restaurant);
  if (!promotion || previous <= 0 || previous < promotion.minimum) return null;
  const discount = promotion.kind === "percent" ? Math.min(Math.floor(previous * promotion.value / 100), previous)
    : promotion.kind === "amount" ? Math.min(promotion.value, previous)
    : 0;
  return discount > 0 ? {price: previous - discount, previous} : null;
}

/** Le tarif de livraison le plus bas du catalogue — un fait, pas une promesse commerciale. */
export function cheapestDelivery(restaurants: Restaurant[]): number {
  const fees = restaurants.filter(restaurant => restaurant.acceptingOrders).map(restaurant => restaurant.delivery);
  return fees.length ? Math.min(...fees) : 0;
}

/** Les adresses qui pratiquent ce tarif, pour que « livraison à X € » soit vérifiable. */
export function cheapestDeliveryCount(restaurants: Restaurant[]): number {
  const fee = cheapestDelivery(restaurants);
  return restaurants.filter(restaurant => restaurant.acceptingOrders && restaurant.delivery === fee).length;
}

/**
 * Vrai si l'offre se termine dans la quinzaine : seule une échéance proche mérite
 * d'être datée sur la carte, sinon l'étiquette dirait « jusqu'en 2030 ».
 */
export function endsSoon(promotion: PublicPromotion, now = new Date()): boolean {
  const end = new Date(promotion.endsAt);
  if (!Number.isFinite(end.getTime())) return false;
  const days = (end.getTime() - now.getTime()) / 86_400_000;
  return days >= 0 && days <= 14;
}

/** Les conditions arrivent du serveur en une phrase « a · b · c » : chaque part se traduit seule. */
export const conditionParts = (conditions: string) => conditions.split(" · ").filter(Boolean);

/**
 * Le résumé court d'une offre, pour la pastille d'une ligne de liste où le nom du
 * restaurant est déjà écrit juste à côté. C'est le barème lui-même, mis en forme :
 * rien n'est inventé par la page.
 */
export function offerBadge(promotion: PublicPromotion): {source: string; params: Record<string, string | number>} {
  if (promotion.kind === "percent") return {source: "−{value} %", params: {value: promotion.value}};
  if (promotion.kind === "amount") return {source: "−{price}", params: {price: money(promotion.value)}};
  return {source: "Livraison offerte", params: {}};
}

/** Les conditions à écrire sur la carte d'un restaurant : celle du restaurant est déjà dite par la carte. */
export const cardConditions = (conditions: string) =>
  conditionParts(conditions).filter(part => part !== "chez ce restaurant uniquement");
