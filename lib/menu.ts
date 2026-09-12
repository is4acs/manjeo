export type Product = { id: string; name: string; description: string; price: number; group: string; image?: string; large?: boolean; popular?: boolean; available: boolean };
export type Restaurant = { id: string; name: string; description: string; category: string; image: string; imageAlt: string; tag: string; rating: number; minutes: number; delivery: number; from: number; products: Product[]; acceptingOrders: boolean };
export const money = (cents: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
export const categories = [{name:"Tout",emoji:"🍽️"},{name:"Créole",emoji:"🍛"},{name:"Burgers",emoji:"🍔"},{name:"Pizzas",emoji:"🍕"},{name:"Healthy",emoji:"🥗"},{name:"Poulet",emoji:"🍗"},{name:"De la mer",emoji:"🦐"}];
