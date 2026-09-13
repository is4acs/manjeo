"use client";
import { t } from "@/lib/i18n";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Promo, Restaurant } from "@/lib/menu";
import RestaurantRow from "./restaurant-row";
import "./tables.css";

export const sorts = [{id: "fast", label: "Le plus rapide"}, {id: "recommended", label: "Mieux notés"}, {id: "price", label: "Prix croissant"}];

/** Rayon « Toutes les tables ouvertes » : le tri complet vit ici, pas dans la barre de filtres. */
export default function Tables({rows, promos, surcharge, pickup, sort, onSort, featuredId, onOpen, remaining, onMore, onReset, filtered}: {
  rows: Restaurant[]; promos: Map<string, Promo>; surcharge: number; pickup: boolean;
  sort: string; onSort: (sort: string) => void; featuredId: string;
  onOpen: (restaurant: Restaurant) => void; remaining: number; onMore: () => void;
  onReset: () => void; filtered: boolean;
}) {
  const title = t("Toutes les tables ouvertes");
  return <section className="tables-section" aria-label={title}>
    <div className="rail-heading">
      <h2>{title}</h2>
      <span className="rail-note">{t("de Cayenne à Matoury")}</span>
      <div className="sort-control" role="group" aria-label={t("Trier les tables")}>
        <span className="sort-label">{t("Trier :")}</span>
        {sorts.map(option => <button type="button" key={option.id} className={sort === option.id ? "selected" : ""}
          aria-pressed={sort === option.id} onClick={() => onSort(option.id)}>{t(option.label)}</button>)}
      </div>
    </div>
    {pickup && <p className="tables-note">{t("Les horaires de retrait sont indicatifs : cette démonstration termine toujours la commande en livraison.")}</p>}
    <div className="restaurant-list">
      {rows.map(restaurant => <RestaurantRow key={restaurant.id} restaurant={restaurant} promo={promos.get(restaurant.id) || null}
        surcharge={surcharge} pickup={pickup} featured={restaurant.id === featuredId} onOpen={onOpen}/>)}
    </div>
    {!rows.length && <div className="no-results">
      <Search size={32}/>
      <h3>{t("Aucune table ne correspond")}</h3>
      <p>{t(filtered ? "Retirez un filtre ou choisissez une autre envie." : "Essayez « poulet », « burger » ou une autre cuisine.")}</p>
      <Button variant="outline" onClick={onReset}>{t("Effacer les filtres")}</Button>
    </div>}
    <div className="list-foot">
      <span>{t("Restaurants et produits fictifs — démonstration.")}</span>
      {remaining > 0 && <Button variant="outline" onClick={onMore}>{t(remaining > 1 ? "Voir {count} tables de plus" : "Voir {count} table de plus", {count: remaining})}</Button>}
    </div>
  </section>;
}
