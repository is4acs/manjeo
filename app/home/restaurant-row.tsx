import { t } from "@/lib/i18n";
import type { Promo, Restaurant } from "@/lib/menu";
import OfferFlag from "./offer-flag";
import { PriceTag, metaLine } from "./meta";
import { callPrice } from "./promos";
import "./restaurant-row.css";

/** Une ligne cadrée d'un trait de 2 px — jamais une carte arrondie générique. */
export default function RestaurantRow({restaurant, promo, surcharge, pickup, featured, onOpen}: {
  restaurant: Restaurant; promo: Promo | null; surcharge: number; pickup: boolean; featured: boolean;
  onOpen: (restaurant: Restaurant) => void;
}) {
  const paused = !restaurant.acceptingOrders;
  return <button type="button" className={`restaurant-row ${featured ? "featured" : ""}`} onClick={() => onOpen(restaurant)}>
    <span className="restaurant-image"><img src={restaurant.image} alt={t(restaurant.imageAlt)} loading="lazy"/></span>
    <span className="restaurant-info">
      <span className="restaurant-title">
        <span className="restaurant-name">{restaurant.name}</span>
        {paused ? <span className="restaurant-tag paused">{t("En pause")}</span> : promo && <OfferFlag promo={promo} variant="pill"/>}
      </span>
      <span className="restaurant-desc">{t(restaurant.description)}{restaurant.area ? ` · ${restaurant.area}` : ""}</span>
      <span className="restaurant-meta">{metaLine(restaurant, surcharge, pickup, true)}</span>
    </span>
    <span className="restaurant-action">
      <PriceTag call={callPrice(restaurant, promo)}/>
      <span className="row-button">{t("Commander")}</span>
    </span>
  </button>;
}
