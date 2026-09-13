"use client";
import type { FormEvent } from "react";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { money, type Product, type Restaurant } from "@/lib/menu";
import AddressField from "../address-field";
import "./hero.css";

/** Premier passage : le héros explique ce que l'adresse déclenche, puis disparaît pour de bon
 * dès qu'une adresse est enregistrée. Sa hauteur est contenue pour que les filtres restent visibles. */
export default function Hero({restaurant, product, address, city, count, disabled, onAddress, onCity, onSubmit}: {
  restaurant: Restaurant; product: Product | undefined; address: string; city: string; count: number;
  disabled: boolean; onAddress: (value: string) => void; onCity: (city: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <section className="home-hero">
    <div className="hero-copy">
      <span className="hero-badge">{t("La Guyane a bon goût")}</span>
      <h1>{t("Le marché de Cayenne, livré chaud.")}</h1>
      <p>{t("{count} restaurants du centre, de Rémire-Montjoly et de Matoury. Entrez votre adresse : on vous montre qui livre chez vous, en combien de temps et à quel prix.", {count})}</p>
      <form className="hero-address" onSubmit={onSubmit}>
        <AddressField value={address} city={city} onChange={onAddress} onPick={suggestion => onCity(suggestion.city)}
          inputProps={{disabled, "aria-label": t("Votre adresse de livraison"), placeholder: t("Ex. 12 rue Lallouette, Cayenne"), maxLength: 180}}/>
        <Button type="submit" disabled={disabled}>{t("Commander")}</Button>
      </form>
    </div>
    <div className="hero-visual">
      <div className="hero-photo"><img src={restaurant.image} alt={t(restaurant.imageAlt)}/></div>
      {product && <div className="hero-sticker">
        <small>{t("Plat du jour")}</small>
        <strong>{money(product.price)}</strong>
      </div>}
    </div>
  </section>;
}
