"use client";
import type { ComponentType } from "react";
import { t } from "@/lib/i18n";
import { ChevronRight, Drumstick, Fish, Flame, LayoutGrid, Pizza, Sandwich, Soup, Utensils } from "lucide-react";
import { categories, type Restaurant } from "@/lib/menu";
import "./categories.css";

// Des glyphes Lucide, jamais d'emoji : c'est là que les concurrents en mettent.
const icons: Record<string, ComponentType<{size?: number}>> = {
  "Tout": LayoutGrid, "Créole": Flame, "De la mer": Fish, "Burgers": Sandwich,
  "Poulet": Drumstick, "Pizzas": Pizza, "Bowls": Soup,
};

export default function Categories({restaurants, value, onChange, onSeeAll}: {
  restaurants: Restaurant[]; value: string; onChange: (category: string) => void; onSeeAll: () => void;
}) {
  // Une catégorie sans table ouverte n'est pas proposée : un filtre ne doit jamais mener au vide.
  const open = categories.filter(name => name === "Tout" || restaurants.some(restaurant => restaurant.category === name));
  return <div className="category-row" role="group" aria-label={t("Types de cuisine")}>
    {open.map(name => {
      const Icon = icons[name] || Utensils;
      return <button type="button" key={name} className={`category-chip ${value === name ? "selected" : ""}`}
        aria-pressed={value === name} onClick={() => onChange(name)}>
        <span className="category-badge"><Icon size={26}/></span>
        <span className="category-name">{t(name)}</span>
      </button>;
    })}
    <button type="button" className="category-chip category-all" onClick={onSeeAll}>
      <span className="category-badge"><ChevronRight size={26}/></span>
      <span className="category-name">{t("Voir tout")}</span>
    </button>
  </div>;
}
