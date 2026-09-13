import { localeTag } from "./i18n.ts";
export type OptionChoice = { id: string; name: string; price: number };
export type OptionGroup = { id: string; name: string; min: number; max: number; choices: OptionChoice[] };
export type Selection = { groupId: string; choiceIds: string[] };
export type Product = { id: string; name: string; description: string; price: number; group: string; image?: string; large?: boolean; popular?: boolean; available: boolean; version: number; archived: boolean; allergens: string; optionGroups: OptionGroup[] };
export type PromoKind = "percent" | "bundle" | "freeItem";
/** Offre du catalogue : le libellé est affiché tel quel, la remise sert au prix d’appel barré. */
export type Promo = { id: string; kind: PromoKind; value: number; label: string; scope?: string; startsAt: string; endsAt: string; highlight?: boolean };
export type Restaurant = { id: string; name: string; description: string; category: string; area?: string; promos?: Promo[]; image: string; imageAlt: string; tag: string; rating: number; minutes: number; delivery: number; from: number; products: Product[]; acceptingOrders: boolean; menuVersion: number; categories: string[]; pickupAddress: string; pickupCity: string };
export const money = (cents: number) => new Intl.NumberFormat(localeTag(), { style: "currency", currency: "EUR" }).format(cents / 100);
// Ordre d’affichage de la rangée de catégories ; « Tout » reste l’état par défaut du filtre.
// Une catégorie sans table ouverte n’est pas rendue : la rangée se construit sur le catalogue reçu.
export const categories = ["Tout", "Créole", "De la mer", "Burgers", "Poulet", "Pizzas", "Bowls"];
