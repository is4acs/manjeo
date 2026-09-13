"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { t } from "@/lib/i18n";
import type { Order, PublicPromotion } from "@/lib/api";
import type { Restaurant } from "@/lib/menu";
import Categories from "./categories";
import Filters, { filtersActive, noFilters, type HomeFilters } from "./filters";
import Hero from "./hero";
import MobileTabs from "./mobile-tabs";
import OrderBanner from "./order-banner";
import PromoCards from "./promo-cards";
import PromoRail from "./promo-rail";
import Reassurance from "./reassurance";
import Tables from "./tables";
import { promoIndex, startingPrice } from "./promos";
import type { ServiceMode } from "./header";
import "./home-screen.css";

const pageSize = 6;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const haystack = (restaurant: Restaurant) => `${restaurant.name} ${restaurant.description} ${t(restaurant.description)} ${restaurant.area || ""} ${restaurant.category} ${t(restaurant.category)} ${restaurant.products.map(product => `${product.name} ${t(product.name)}`).join(" ")}`;
// Les transitions restent fonctionnelles : aucun défilement animé quand le visiteur le refuse.
const scrollToBlock = (element: HTMLElement | null) => element?.scrollIntoView({behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start"});

/** L'accueil mené par les offres. Toute la logique de commande reste dans app/page.tsx :
 * cet écran ne tient que ses propres réglages (catégorie, filtres, tri, carrousels). */
export default function HomeScreen({
  restaurants, search, serviceMode, address, city, surcharge, submitting,
  promotions, appliedCode, onUsePromotion, order, otherOrders, onTrackOrder,
  onAddress, onCity, onStartOrder, onOpenRestaurant, onCart, onAccount,
}: {
  restaurants: Restaurant[]; search: string; serviceMode: ServiceMode;
  address: string; city: string; surcharge: number; submitting: boolean;
  promotions: PublicPromotion[]; appliedCode: string; onUsePromotion: (promotion: PublicPromotion) => void;
  order: Order | null; otherOrders: number; onTrackOrder: (order: Order) => void;
  onAddress: (value: string) => void; onCity: (city: string) => void;
  onStartOrder: (event: FormEvent<HTMLFormElement>) => void;
  onOpenRestaurant: (restaurant: Restaurant) => void; onCart: () => void; onAccount: () => void;
}) {
  const [category, setCategory] = useState("Tout");
  const [filters, setFilters] = useState<HomeFilters>(noFilters);
  const [sort, setSort] = useState("fast");
  const [visible, setVisible] = useState(pageSize);
  const [at, setAt] = useState(() => Date.now());
  const offersRef = useRef<HTMLDivElement>(null);
  const tablesRef = useRef<HTMLDivElement>(null);
  const pickup = serviceMode === "pickup";

  // Une offre expirée doit disparaître sans rechargement : l'horloge suffit, rien ne clignote.
  useEffect(() => { const timer = window.setInterval(() => setAt(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { setVisible(pageSize); }, [category, search, sort, filters]);

  const promos = useMemo(() => promoIndex(restaurants, at), [restaurants, at]);
  const deliveryFloor = useMemo(() => restaurants.reduce((low, restaurant) => Math.min(low, restaurant.delivery + surcharge), Infinity), [restaurants, surcharge]);
  const matches = useMemo(() => restaurants.filter(restaurant =>
    (category === "Tout" || restaurant.category === category)
    && normalize(haystack(restaurant)).includes(normalize(search))
    && (!filters.offersOnly || promos.has(restaurant.id))
    && (filters.maxMinutes === null || restaurant.minutes < filters.maxMinutes)
    && (filters.maxDeliveryFee === null || restaurant.delivery + surcharge <= filters.maxDeliveryFee)
    && (filters.minRating === null || restaurant.rating >= filters.minRating)),
  [restaurants, category, search, filters, promos, surcharge]);
  const rows = useMemo(() => [...matches].sort((first, second) => sort === "fast" ? first.minutes - second.minutes
    : sort === "price" ? startingPrice(first) - startingPrice(second) : second.rating - first.rating), [matches, sort]);
  const onOffer = matches.filter(restaurant => promos.has(restaurant.id));
  // Un code qui vise une table écartée par les filtres n'a rien à faire sur la page filtrée.
  const deals = promotions.filter(promotion => !promotion.restaurantId || matches.some(restaurant => restaurant.id === promotion.restaurantId));
  const featuredId = restaurants.find(restaurant => restaurant.tag === "Coup de cœur" && restaurant.acceptingOrders)?.id || "";
  const hero = restaurants[0];
  const heroProduct = hero?.products.find(product => product.popular && product.available) || hero?.products[0];

  function reset() { setCategory("Tout"); setFilters(noFilters); }

  return <div className="home-screen">
    {order && <OrderBanner order={order} others={otherOrders} onTrack={onTrackOrder}/>}
    {!address.trim() && hero && <Hero restaurant={hero} product={heroProduct} address={address} city={city}
      count={restaurants.length} disabled={submitting} onAddress={onAddress} onCity={onCity} onSubmit={onStartOrder}/>}
    <Categories restaurants={restaurants} value={category} onChange={setCategory}
      onSeeAll={() => { reset(); scrollToBlock(tablesRef.current); }}/>
    <Filters filters={filters} onChange={setFilters} deliveryFloor={Number.isFinite(deliveryFloor) ? deliveryFloor : 0}
      count={matches.length} at={at} pickup={pickup}/>
    <div ref={offersRef}>
      <PromoRail promotions={deals} restaurants={restaurants} appliedCode={appliedCode} onUse={onUsePromotion}/>
    </div>
    <PromoCards restaurants={onOffer} promos={promos} surcharge={surcharge} pickup={pickup}
      onOpen={onOpenRestaurant} onSeeAll={() => { setFilters({...filters, offersOnly: true}); scrollToBlock(tablesRef.current); }}/>
    <div ref={tablesRef}>
      <Tables rows={rows.slice(0, visible)} promos={promos} surcharge={surcharge} pickup={pickup}
        sort={sort} onSort={setSort} featuredId={featuredId} onOpen={onOpenRestaurant}
        remaining={Math.max(0, rows.length - visible)} onMore={() => setVisible(current => current + pageSize)}
        onReset={reset} filtered={filtersActive(filters) || category !== "Tout"}/>
    </div>
    <Reassurance count={restaurants.length}/>
    <MobileTabs hasOffers={deals.length > 0} onHome={() => window.scrollTo({top: 0, behavior: "instant"})}
      onOffers={() => scrollToBlock(offersRef.current)} onCart={onCart} onAccount={onAccount}/>
  </div>;
}
