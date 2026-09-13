"use client";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { ChevronDown, MapPin, PackageCheck, Search, ShoppingBag, UserRound, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { money } from "@/lib/menu";
import type { User } from "@/lib/api";
import "./header.css";

export type ServiceMode = "delivery" | "pickup";

/** En-tête encre. Le champ de recherche n'apparaît qu'une fois l'adresse connue :
 * au premier passage, c'est le héros qui demande l'adresse. */
export default function SiteHeader({
  user, address, city, serviceMode, onServiceMode, service, search, onSearch, searchable,
  count, total, disabled, languageControl, onHome, onLocation, onOrders, onAccount, onStaff, onCart,
}: {
  user: User | null; address: string; city: string;
  serviceMode: ServiceMode; onServiceMode: (mode: ServiceMode) => void; service: boolean;
  search: string; onSearch: (value: string) => void; searchable: boolean;
  count: number; total: number; disabled: boolean; languageControl?: ReactNode;
  onHome: () => void; onLocation: () => void; onOrders: () => void;
  onAccount: () => void; onStaff: () => void; onCart: () => void;
}) {
  const place = address ? `${address}, ${city}` : city;
  return <header className="site-header"><div className="header-inner">
    <button className="brand" aria-label={t("manjéo, accueil")} onClick={onHome}>manjéo</button>
    {service && <div className="service-toggle" role="group" aria-label={t("Mode de service")}>
      <button type="button" className={serviceMode === "delivery" ? "selected" : ""} aria-pressed={serviceMode === "delivery"}
        onClick={() => onServiceMode("delivery")}>{t("Livraison")}</button>
      <button type="button" className={serviceMode === "pickup" ? "selected" : ""} aria-pressed={serviceMode === "pickup"}
        onClick={() => onServiceMode("pickup")}>{t("À emporter")}</button>
    </div>}
    <button type="button" disabled={disabled} className="location-button"
      aria-label={t("Adresse de livraison : {address}", {address: place})} onClick={onLocation}>
      <MapPin size={16}/><strong>{place}</strong><ChevronDown size={14}/>
    </button>
    {searchable && <label className="search-box">
      <Search size={17}/>
      <Input aria-label={t("Rechercher un restaurant ou un plat")} placeholder={t("Chercher un plat ou un restaurant")}
        value={search} onChange={event => onSearch(event.target.value)}/>
      {search && <button type="button" aria-label={t("Effacer la recherche")} onClick={() => onSearch("")}><X size={14}/></button>}
    </label>}
    <div className="header-actions">
      {user && user.role !== "client" && <button type="button" className="account-staff-button" onClick={onStaff}>
        {user.role === "admin" ? t("Administration") : user.role === "courier" ? t("Mes livraisons") : t("Mon restaurant")}
      </button>}
      {languageControl}
      <button type="button" className="account-header-button" onClick={onAccount}
        aria-label={user ? t("Mon compte, {name}", {name: user.name}) : t("Se connecter")}>
        <UserRound size={17}/><span>{user ? user.name : t("Connexion")}</span>
      </button>
      <button type="button" className="account-mobile-orders" aria-label={t("Mes commandes")} onClick={onOrders}><PackageCheck size={18}/></button>
      <button type="button" className="header-cart" onClick={onCart}
        aria-label={t(count > 1 ? "Ouvrir le panier, {count} articles, {total}" : "Ouvrir le panier, {count} article, {total}", {count, total: money(total)})}>
        <ShoppingBag size={16}/><span className="header-cart-label">{count ? money(total) : t("Panier")}</span>
      </button>
    </div>
  </div></header>;
}
