import { t, localeTag } from "@/lib/i18n";
import { money, type Restaurant } from "@/lib/menu";
import type { CallPrice } from "./promos";

// « ★ » est un caractère typographique, pas une icône : aucun emoji dans cette direction.
export function metaLine(restaurant: Restaurant, surcharge: number, pickup: boolean, long = false): string {
  const rating = restaurant.rating.toLocaleString(localeTag(), {minimumFractionDigits: 1});
  if (pickup) return `★ ${rating} · ${t("Retrait en {minutes} min", {minutes: restaurant.minutes})}`;
  return `★ ${rating} · ${t(long ? "{minutes} min · {price} de livraison" : "{minutes} min · {price}", {minutes: restaurant.minutes, price: money(restaurant.delivery + surcharge)})}`;
}

/** Le prix remisé passe devant, l'ancien suit barré : on comprend l'économie sans calculer. */
export function PriceTag({call}: {call: CallPrice}) {
  return <span className="offer-price">
    {t("dès {price}", {price: money(call.price)})}
    {call.previous !== null && <s>{money(call.previous)}</s>}
  </span>;
}
