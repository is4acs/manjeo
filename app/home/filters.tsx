"use client";
import { t, formatDate } from "@/lib/i18n";
import { Tag } from "lucide-react";
import { money } from "@/lib/menu";
import "./filters.css";

/** Quatre filtres, pas douze : le tri complet reste dans l'en-tête du rayon des tables. */
export type HomeFilters = { offersOnly: boolean; maxMinutes: number | null; maxDeliveryFee: number | null; minRating: number | null };
export const noFilters: HomeFilters = {offersOnly: false, maxMinutes: null, maxDeliveryFee: null, minRating: null};
export const quickMinutes = 25;
export const goodRating = 4.8;
export const filtersActive = (filters: HomeFilters) =>
  filters.offersOnly || filters.maxMinutes !== null || filters.maxDeliveryFee !== null || filters.minRating !== null;

export default function Filters({filters, onChange, deliveryFloor, count, at, pickup}: {
  filters: HomeFilters; onChange: (filters: HomeFilters) => void;
  deliveryFloor: number; count: number; at: number; pickup: boolean;
}) {
  const day = formatDate(new Date(at).toISOString(), {weekday: "long"});
  const time = formatDate(new Date(at).toISOString(), {hour: "2-digit", minute: "2-digit"});
  const pill = (active: boolean) => `home-filter ${active ? "selected" : ""}`;
  return <div className="home-filters" role="group" aria-label={t("Filtrer les tables")}>
    <button type="button" className={pill(filters.offersOnly)} aria-pressed={filters.offersOnly}
      onClick={() => onChange({...filters, offersOnly: !filters.offersOnly})}>
      <Tag size={15}/>{t("Offres")}
    </button>
    <button type="button" className={pill(filters.maxMinutes !== null)} aria-pressed={filters.maxMinutes !== null}
      onClick={() => onChange({...filters, maxMinutes: filters.maxMinutes === null ? quickMinutes : null})}>
      {t("Moins de {minutes} min", {minutes: quickMinutes})}
    </button>
    {!pickup && <button type="button" className={pill(filters.maxDeliveryFee !== null)} aria-pressed={filters.maxDeliveryFee !== null}
      onClick={() => onChange({...filters, maxDeliveryFee: filters.maxDeliveryFee === null ? deliveryFloor : null})}>
      {t("Livraison à {price}", {price: money(deliveryFloor)})}
    </button>}
    <button type="button" className={pill(filters.minRating !== null)} aria-pressed={filters.minRating !== null}
      onClick={() => onChange({...filters, minRating: filters.minRating === null ? goodRating : null})}>
      {t("Mieux notés")}
    </button>
    <span className="home-filters-count">{t(count > 1 ? "{count} tables ouvertes · {day}, {time}" : "{count} table ouverte · {day}, {time}", {count, day, time})}</span>
  </div>;
}
