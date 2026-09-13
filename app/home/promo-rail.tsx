"use client";
import { t } from "@/lib/i18n";
import type { PublicPromotion } from "@/lib/api";
import type { Restaurant } from "@/lib/menu";
import DealCard from "./deal-card";
import { RailDots, RailHeading, useRail } from "./rail";
import { useColumns } from "./use-columns";
import "./promo-rail.css";

/** Les codes ouverts du catalogue, remontés sur l'accueil : plus aucun code à retaper. */
export default function PromoRail({promotions, restaurants, appliedCode, onUse}: {
  promotions: PublicPromotion[]; restaurants: Restaurant[]; appliedCode: string;
  onUse: (promotion: PublicPromotion) => void;
}) {
  const columns = useColumns(3, 2, 1);
  const rail = useRail(promotions.length, columns);
  if (!promotions.length) return null;
  const title = t("Les bons plans du moment");
  return <section className="deal-rail" aria-label={title}>
    <RailHeading title={title} rail={rail} arrows
      note={t(promotions.length > 1 ? "{count} offres à utiliser dans votre panier" : "{count} offre à utiliser dans votre panier", {count: promotions.length})}/>
    <div className="deal-grid">
      {promotions.slice(rail.index, rail.index + columns).map((promotion, position) => <DealCard key={promotion.code}
        promotion={promotion} tone={position} applied={appliedCode === promotion.code}
        restaurant={restaurants.find(item => item.id === promotion.restaurantId)?.name || ""}
        onUse={() => onUse(promotion)}/>)}
    </div>
    <div className="rail-foot"><RailDots rail={rail} label={t("Choisir un bon plan")}/></div>
  </section>;
}
