import { localeTag } from "./i18n.ts";
export type OptionChoice = { id: string; name: string; price: number };
export type OptionGroup = { id: string; name: string; min: number; max: number; choices: OptionChoice[] };
export type Selection = { groupId: string; choiceIds: string[] };
export type Product = { id: string; name: string; description: string; price: number; group: string; image?: string; large?: boolean; popular?: boolean; available: boolean; version: number; archived: boolean; allergens: string; optionGroups: OptionGroup[] };
export type Restaurant = { id: string; name: string; description: string; category: string; area?: string; image: string; imageAlt: string; tag: string; rating: number; minutes: number; delivery: number; from: number; products: Product[]; acceptingOrders: boolean; menuVersion: number; categories: string[]; pickupAddress: string; pickupCity: string };
export const money = (cents: number) => new Intl.NumberFormat(localeTag(), { style: "currency", currency: "EUR" }).format(cents / 100);
// L’accueil affiche ces envies dans l’ordre du rail « Punch » ; « Tout » reste l’état par défaut du filtre.
export const categories = ["Tout", "Créole", "De la mer", "Burgers", "Poulet", "Pizzas", "Healthy"];
// Prix d’appel : le plat le moins cher de la carte principale, jamais la boisson à 3,50 €.
export const startingPrice = (restaurant: Restaurant) => {
  const main = restaurant.categories?.[0];
  const available = restaurant.products.filter(item => item.available && !item.archived);
  const dishes = main ? available.filter(item => item.group === main) : available;
  const prices = (dishes.length ? dishes : available).map(item => item.price);
  return prices.length ? Math.min(...prices) : restaurant.from;
};
