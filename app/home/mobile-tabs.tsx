"use client";
import { t } from "@/lib/i18n";
import { House, ShoppingBag, Tag, User } from "lucide-react";
import "./mobile-tabs.css";

/** Barre d'onglets mobile — le seul endroit du produit où un libellé descend sous 13 px. */
export default function MobileTabs({onHome, onOffers, onCart, onAccount, hasOffers}: {
  onHome: () => void; onOffers: () => void; onCart: () => void; onAccount: () => void; hasOffers: boolean;
}) {
  return <nav className="mobile-tabs" aria-label={t("Navigation principale")}>
    <button type="button" className="selected" aria-current="page" onClick={onHome}><House size={22}/>{t("Accueil")}</button>
    {hasOffers && <button type="button" onClick={onOffers}><Tag size={22}/>{t("Offres")}</button>}
    <button type="button" onClick={onCart}><ShoppingBag size={22}/>{t("Panier")}</button>
    <button type="button" onClick={onAccount}><User size={22}/>{t("Compte")}</button>
  </nav>;
}
