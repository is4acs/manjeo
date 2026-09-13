import { t } from "@/lib/i18n";
import { clockLabel } from "../deadline";
import { statusLabels, type Order, type OrderStatus } from "@/lib/api";
import "./order-banner.css";

const titles: Record<OrderStatus, string> = {
  awaiting_payment: "Commande {id} à confirmer",
  pending: "Commande {id} envoyée",
  accepted: "Commande {id} acceptée",
  preparing: "Commande {id} en préparation",
  ready: "Commande {id} prête",
  picked_up: "Commande {id} en route",
  delivered: "Commande {id} livrée",
  cancelled: "Commande {id} annulée",
};

/** Première ligne de la page quand une commande est active. Le halo jaune est le seul
 * usage de l'accent comme indicateur d'état, et il ne clignote pas. */
export default function OrderBanner({order, others, onTrack}: {order: Order; others: number; onTrack: (order: Order) => void}) {
  const eta = order.eta && !["delivered", "cancelled"].includes(order.status) ? clockLabel(order.eta) : "";
  const parts = [order.restaurant, t(statusLabels[order.status]), eta && t("arrivée vers {time}", {time: eta})].filter(Boolean);
  return <section className="active-order-card order-banner" aria-label={t("Commande en cours")}>
    <span className="order-pulse" aria-hidden="true"/>
    <div className="order-banner-copy">
      <strong>{t(titles[order.status], {id: order.id})}</strong>
      <span>{parts.join(" · ")}</span>
    </div>
    <div className="order-banner-actions">
      {others > 0 && <span className="order-banner-more">{t(others > 1 ? "et {count} autres commandes" : "et {count} autre commande", {count: others})}</span>}
      {order.courierName && <button type="button" className="text-link" onClick={() => onTrack(order)}>{t("Écrire à {name}", {name: order.courierName})}</button>}
      <button type="button" className="order-banner-track" onClick={() => onTrack(order)}>{t("Suivre la livraison")}</button>
    </div>
  </section>;
}
