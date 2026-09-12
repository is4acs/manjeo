import { Bike, Check, Clock3, KeyRound } from "lucide-react";
import { clockLabel, countdown, isLate, useCountdown } from "./deadline";
import { statusLabels, type Order, type OrderStatus } from "@/lib/api";

const steps: OrderStatus[] = ["pending", "accepted", "preparing", "ready", "picked_up", "delivered"];
const explanations: Record<OrderStatus, string> = {
  pending: "Le restaurant va examiner votre commande.",
  accepted: "Le restaurant a accepté votre commande.",
  preparing: "Votre repas est en cours de préparation.",
  ready: "Votre commande est prête à être remise au livreur.",
  picked_up: "Le livreur a récupéré votre commande. Gardez votre code de remise à portée de main.",
  delivered: "La remise de votre commande a été confirmée avec votre code.",
  cancelled: "Cette commande a été annulée. Aucun paiement n’a été débité dans cette démonstration.",
};
// Compte à rebours d'acceptation : au bout de dix minutes le serveur annule la commande.
function Countdown({deadline}: {deadline: string}) {
  const seconds = useCountdown(deadline);
  return <p className="tracking-deadline"><Clock3 size={16}/><span>{seconds > 0
    ? <>Réponse du restaurant sous <strong>{countdown(seconds)}</strong> — sans réponse, la commande s’annule et vous n’êtes pas débité.</>
    : <>Le délai est écoulé. Nous vérifions la réponse du restaurant.</>}</span></p>;
}

export default function OrderTracking({order, onCancel}: {order: Order; onCancel?: (order: Order) => void}) {
  const index = steps.indexOf(order.status);
  useCountdown(order.status === "delivered" || order.status === "cancelled" ? null : order.eta);
  return <section className="customer-tracking" aria-label={`Suivi ${order.id}`}>
    <p className="tracking-explanation">{order.status === "delivered" && !order.courierId ? "Commande de démonstration terminée." : explanations[order.status]}</p>
    {order.status === "pending" && order.acceptBy && <Countdown deadline={order.acceptBy}/>}
    {order.eta && !["delivered", "cancelled"].includes(order.status) && <p className="tracking-deadline"><Clock3 size={16}/><span>Livraison estimée vers <strong>{clockLabel(order.eta)}</strong>{isLate(order.eta, order.status) ? " — le retard est signalé au restaurant et au livreur." : "."}</span></p>}
    {order.status !== "cancelled" && <ol className="tracking-steps">{steps.map((status, position) => <li key={status} className={position <= index ? "tracking-complete" : ""} aria-current={position === index ? "step" : undefined}><span>{position < index ? <Check size={11}/> : position + 1}</span><small>{statusLabels[status]}</small></li>)}</ol>}
    {order.courierName && order.status !== "cancelled" && <p className="tracking-courier"><Bike size={18}/><span><strong>{order.courierName}</strong>{order.status === "picked_up" ? " apporte votre commande." : order.status === "delivered" ? " a assuré votre livraison test." : " a pris en charge votre course."}</span></p>}
    {!order.courierId && ["accepted", "preparing", "ready"].includes(order.status) && <p className="tracking-courier"><Bike size={18}/>En attente de la prise en charge par un livreur.</p>}
    {order.deliveryCode && order.status === "picked_up" && <div className="delivery-code"><KeyRound size={21}/><div><span>Votre code de remise</span><strong aria-label={`Code de remise ${order.deliveryCode}`}>{order.deliveryCode}</strong><p>Communiquez ce code au livreur uniquement quand vous recevez votre commande.</p></div></div>}
    {order.status === "pending" && onCancel && <button type="button" className="customer-cancel" onClick={() => onCancel(order)}>Annuler avant acceptation</button>}
    <details className="tracking-events"><summary>Historique des étapes</summary><ol>{order.history.map((event, eventIndex) => <li key={`${event.date}-${eventIndex}`}><span>{event.label || statusLabels[event.status]}{event.actorName && <small> · {event.actorName}</small>}</span><time dateTime={event.date}>{new Date(event.date).toLocaleTimeString("fr-FR",{timeZone:"America/Cayenne",hour:"2-digit",minute:"2-digit"})}</time></li>)}</ol></details>
  </section>;
}
