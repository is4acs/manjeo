"use client";
import { t } from "@/lib/i18n";
import type { Promo, Restaurant } from "@/lib/menu";
import OfferFlag from "./offer-flag";
import { PriceTag, metaLine } from "./meta";
import { RailDots, RailHeading, useRail } from "./rail";
import { useColumns } from "./use-columns";
import { callPrice } from "./promos";
import "./promo-cards.css";

/** Rayon « En promotion ce soir » : une carte par table qui porte une offre du catalogue. */
export default function PromoCards({restaurants, promos, surcharge, pickup, onOpen, onSeeAll}: {
  restaurants: Restaurant[]; promos: Map<string, Promo>; surcharge: number; pickup: boolean;
  onOpen: (restaurant: Restaurant) => void; onSeeAll: () => void;
}) {
  const columns = useColumns(4, 2, 1);
  const rail = useRail(restaurants.length, columns);
  if (!restaurants.length) return null;
  const title = t("En promotion ce soir");
  return <section className="promo-section" aria-label={title}>
    <RailHeading title={title} rail={rail} arrows
      link={<button type="button" className="rail-link" onClick={onSeeAll}>{t("Tout afficher")}</button>}/>
    <div className="promo-grid">
      {restaurants.slice(rail.index, rail.index + columns).map(restaurant => {
        const promo = promos.get(restaurant.id)!;
        return <button type="button" className="promo-card" key={restaurant.id} onClick={() => onOpen(restaurant)}>
          <span className="promo-photo">
            <img src={restaurant.image} alt={t(restaurant.imageAlt)} loading="lazy"/>
            <OfferFlag promo={promo}/>
          </span>
          <span className="promo-body">
            <span className="promo-name">{restaurant.name}</span>
            <span className="promo-place">{t(restaurant.category)}{restaurant.area ? ` · ${restaurant.area}` : ""}</span>
            <span className="promo-meta">{metaLine(restaurant, surcharge, pickup)}</span>
            <PriceTag call={callPrice(restaurant, promo)}/>
          </span>
        </button>;
      })}
    </div>
    <div className="rail-foot"><RailDots rail={rail} label={t("Choisir une table en promotion")}/></div>
  </section>;
}
