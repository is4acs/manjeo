import { t, tEvent, formatDate } from "@/lib/i18n";
import { Bike, Check, Clock3, KeyRound } from "lucide-react";
import { clockLabel, countdown, isLate, useCountdown } from "./deadline";
import { statusLabels, type Order, type OrderStatus } from "@/lib/api";
import PaymentStatus from './payment-status';

const steps: OrderStatus[] = ["pending", "accepted", "preparing", "ready", "picked_up", "delivered"];
const explanations: Record<OrderStatus, string> = {
  awaiting_payment: "Votre commande sera envoyée au restaurant après confirmation du paiement de test.",
  pending: "Le restaurant va examiner votre commande.",
  accepted: "Le restaurant a accepté votre commande.",
  preparing: "Votre repas est en cours de préparation.",
  ready: "Votre commande est prête à être remise au livreur.",
  picked_up: "Le livreur a récupéré votre commande. Gardez votre code de remise à portée de main.",
  delivered: "La remise de votre commande a été confirmée avec votre code.",
  cancelled: "Cette commande a été annulée.",
};
// Compte à rebours d'acceptation : au bout de dix minutes le serveur annule la commande.
function Countdown({deadline}: {deadline: string}) {
  const seconds = useCountdown(deadline);
  return <p className="tracking-deadline"><Clock3 size={16}/><span>{seconds > 0
    ? <>{t("Réponse du restaurant sous {time} — sans réponse, la commande s’annule.", {time: countdown(seconds)})}</>
    : <>{t("Le délai est écoulé. Nous vérifions la réponse du restaurant.")}</>}</span></p>;
}

export default function OrderTracking({order, onCancel}: {order: Order; onCancel?: (order: Order) => void}) {
  const index = steps.indexOf(order.status);
  useCountdown(order.status === "delivered" || order.status === "cancelled" ? null : order.eta);
  return <section className="customer-tracking" aria-label={t("Suivi {id}", {id: order.id})}>
    <PaymentStatus order={order}/>
    <p className="tracking-explanation">{order.status === "delivered" && !order.courierId ? t("Commande de démonstration terminée.") : t(explanations[order.status])}</p>
    {order.status === "pending" && order.acceptBy && <Countdown deadline={order.acceptBy}/>}
    {order.eta && !["delivered", "cancelled"].includes(order.status) && <p className="tracking-deadline"><Clock3 size={16}/><span>{t(isLate(order.eta, order.status) ? "Livraison estimée vers {time} — le retard est signalé au restaurant et au livreur." : "Livraison estimée vers {time}.", {time: clockLabel(order.eta)})}</span></p>}
    {order.status !== "cancelled" && <ol className="tracking-steps">{steps.map((status, position) => <li key={status} className={position <= index ? "tracking-complete" : ""} aria-current={position === index ? "step" : undefined}><span>{position < index ? <Check size={11}/> : position + 1}</span><small>{t(statusLabels[status])}</small></li>)}</ol>}
    {order.courierName && order.status !== "cancelled" && <p className="tracking-courier"><Bike size={18}/><span>{t(order.status === "picked_up" ? "{name} apporte votre commande." : order.status === "delivered" ? "{name} a assuré votre livraison test." : "{name} a pris en charge votre course.", {name: order.courierName})}</span></p>}
    {!order.courierId && ["accepted", "preparing", "ready"].includes(order.status) && <p className="tracking-courier"><Bike size={18}/>{t("En attente de la prise en charge par un livreur.")}</p>}
    {order.deliveryCode && order.status === "picked_up" && <div className="delivery-code"><KeyRound size={21}/><div><span>{t("Votre code de remise")}</span><strong aria-label={t("Code de remise {code}", {code: order.deliveryCode})}>{order.deliveryCode}</strong><p>{t("Communiquez ce code au livreur uniquement quand vous recevez votre commande.")}</p></div></div>}
    {["awaiting_payment", "pending"].includes(order.status) && onCancel && <button type="button" className="customer-cancel" onClick={() => onCancel(order)}>{t("Annuler avant acceptation")}</button>}
    <details className="tracking-events"><summary>{t("Historique des étapes")}</summary><ol>{order.history.map((event, eventIndex) => <li key={`${event.date}-${eventIndex}`}><span>{tEvent(event.label || statusLabels[event.status])}{event.actorName && <small> · {event.actorName}</small>}</span><time dateTime={event.date}>{formatDate(event.date, {hour:"2-digit",minute:"2-digit"})}</time></li>)}</ol></details>
  </section>;
}
