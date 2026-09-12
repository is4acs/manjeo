import { NavigationLinks } from "./navigation-links";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bike, CheckCircle2, ChevronDown, Clock3, History, KeyRound, LogOut, MapPin, MessageSquare, PackageCheck, Phone, RefreshCw, ShoppingBag, Store, Undo2 , UserRound } from "lucide-react";
import { api, type CourierProfile, type DeliveryOffer, type Order, type User, statusLabels } from "@/lib/api";
import { money } from "@/lib/menu";
import { clockLabel, isLate } from "./deadline";
import OrderChat from "./order-chat";
import "./staff.css";
import { t, formatDate } from "@/lib/i18n";
import "./courier.css";

type CourierData = { available: DeliveryOffer[]; assigned: Order[]; profile: CourierProfile; unread: Record<string, number> };
const activeStatus = (order: Order) => order.status !== "delivered" && order.status !== "cancelled";
const date = (value: string) => formatDate(value, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Courier({ user, onLogout, onShop, onAccount, languageControl }: { user: User; onLogout: () => void; onShop: () => void; onAccount: () => void; languageControl?: React.ReactNode }) {
  const [data, setData] = useState<CourierData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"missions" | "history">("missions");
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [historyChat, setHistoryChat] = useState<string | null>(null);
  const mounted = useRef(true);
  const mutating = useRef(false);
  const sequence = useRef(0);

  useEffect(() => {
    const read = (event: Event) => {
      const detail = (event as CustomEvent<{orderId: string; viewerId: string}>).detail;
      if (detail?.viewerId === user.id) setData(current => current ? {...current, unread: {...current.unread, [detail.orderId]: 0}} : current);
    };
    window.addEventListener("manjeo-thread-read", read);
    return () => window.removeEventListener("manjeo-thread-read", read);
  }, [user.id]);

  const refresh = useCallback(async (silent = false, force = false) => {
    if (mutating.current && !force) return;
    const current = ++sequence.current;
    if (!silent) setRefreshing(true);
    try {
      const result = await api<CourierData>("/api/deliveries", {accountId: user.id});
      if (mounted.current && current === sequence.current) { setData(result); setError(""); }
    } catch (cause) { if (mounted.current && current === sequence.current) setError(cause instanceof Error ? cause.message : "Les courses n’ont pas pu être chargées."); }
    finally { if (mounted.current && current === sequence.current) { setLoading(false); setRefreshing(false); } }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 8000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(true); };
    document.addEventListener("visibilitychange", visible);
    return () => { mounted.current = false; ++sequence.current; window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  const currentOrder = data?.assigned.find(activeStatus);
  const history = data?.assigned.filter(order => !activeStatus(order)) ?? [];
  useEffect(() => { setCode(""); setReason(""); setReleaseOpen(false); }, [currentOrder?.id]);

  async function mutate(key: string, action: () => Promise<unknown>, success: string) {
    if (mutating.current) return;
    mutating.current = true; ++sequence.current; setBusy(key); setRefreshing(false); setError(""); setNotice("");
    let failure = "";
    try {
      const result = await action() as { order?: Order; profile?: CourierProfile; ok?: boolean };
      if (mounted.current) {
        setData(current => {
          if (!current) return current;
          if (result.order) return { ...current, available: [], assigned: [result.order, ...current.assigned.filter(order => order.id !== result.order!.id)], profile: { ...current.profile, activeOrderId: activeStatus(result.order) ? result.order.id : null } };
          if (result.profile) return { ...current, profile: result.profile, available: result.profile.online ? current.available : [] };
          if (key.startsWith("release-") && result.ok) return { ...current, assigned: current.assigned.filter(order => order.id !== key.slice(8)), profile: { ...current.profile, activeOrderId: null } };
          return current;
        });
        setNotice(success); setCode(""); setReason(""); setReleaseOpen(false);
      }
    }
    catch (cause) { failure = cause instanceof Error ? cause.message : "La demande a échoué."; }
    finally {
      if (mounted.current) await refresh(true, true);
      mutating.current = false;
      if (mounted.current) { setBusy(""); if (failure) setError(failure); }
    }
  }
  function changeStatus(order: Order, status: "picked_up" | "delivered") {
    void mutate(`status-${order.id}`, () => api(`/api/orders/${encodeURIComponent(order.id)}`, { method: "PATCH", accountId: user.id, body: JSON.stringify({ status, ...(status === "delivered" ? { deliveryCode: code } : {}) }) }), status === "picked_up" ? "Retrait confirmé. Le client est informé du départ en livraison." : "Livraison confirmée. La mission est terminée.");
  }
  return <div className="staff-app courier-app">
    <header className="staff-header"><div className="staff-header-inner"><button type="button" className="staff-brand" onClick={onShop} aria-label={t("Manjéo, voir la vitrine")}>manjéo<span>•</span></button><span className="staff-space-label"><Bike size={19} />{t("Espace livreur")}</span><div className="staff-header-actions"><button type="button" className="staff-shop-link" onClick={onAccount} aria-label={t("Mon compte")}><UserRound size={15} /><span>{t("Mon compte")}</span></button><button type="button" className="staff-shop-link" onClick={onShop} aria-label={t("Voir la vitrine")}><ArrowLeft size={15} /><span>{t("Voir la vitrine")}</span></button><button type="button" className="staff-logout" onClick={onLogout} aria-label={t("Déconnexion")}><LogOut size={16} /><span>{t("Déconnexion")}</span></button>{languageControl}</div></div></header>
    <main className="staff-main">
      <section className="staff-welcome"><div><p className="staff-eyebrow">{t("LE DERNIER KILOMÈTRE, ENSEMBLE")}</p><h1>{t("Bonjour, {name}.", {name: user.name.split(" ")[0]})}</h1><p>{t("Une course à la fois, de la cuisine à la remise au client.")}</p></div><span className="staff-avatar"><Bike size={25} /></span></section>
      {data && <section className={`staff-service ${data.profile.online ? "staff-service-open" : "staff-service-paused"}`} aria-label={t("Disponibilité du livreur")}><div><span className="staff-service-dot" /><div><strong>{data.profile.online ? t("Vous êtes en ligne") : t("Vous êtes en pause")}</strong><p>{currentOrder ? t("Votre mission reste à terminer, même en pause.") : data.profile.online ? t("Les nouvelles courses disponibles apparaissent ci-dessous.") : t("Passez en ligne pour recevoir des propositions de course.")}</p></div></div><button type="button" role="switch" className="staff-switch" aria-checked={data.profile.online} aria-label={t("Être disponible pour les courses")} disabled={!!busy} onClick={() => void mutate("profile", () => api("/api/courier/profile", { method: "PATCH", accountId: user.id, body: JSON.stringify({ online: !data.profile.online }) }), data.profile.online ? "Vous êtes en pause." : "Vous êtes en ligne.")}><span /></button></section>}
      <div className="staff-navigation"><nav aria-label={t("Courses")}><div className="staff-tabs"><button type="button" className={`staff-tab ${tab === "missions" ? "staff-tab-active" : ""}`} aria-current={tab === "missions" ? "page" : undefined} onClick={() => setTab("missions")}><Bike size={17} />{t("Mes courses")}{currentOrder && <span>1</span>}</button><button type="button" className={`staff-tab ${tab === "history" ? "staff-tab-active" : ""}`} aria-current={tab === "history" ? "page" : undefined} onClick={() => setTab("history")}><History size={17} />{t("Historique")}</button></div></nav><button type="button" className="staff-refresh" disabled={!!busy || refreshing} onClick={() => void refresh()} aria-label={t("Actualiser les courses")}><RefreshCw size={16} className={refreshing ? "staff-spinning" : ""} /><span>{t("Actualiser")}</span></button></div>
      {error && <div className="staff-alert" role="alert"><span>{t(error)}</span><button type="button" onClick={() => setError("")}>{t("Fermer")}</button></div>}{notice && <p className="courier-notice" role="status"><CheckCircle2 size={17} />{t(notice)}</p>}
      {loading ? <div className="staff-loading" role="status"><RefreshCw className="staff-spinning" size={24} /><p>{t("Chargement de votre espace…")}</p></div> : !data ? <div className="staff-empty"><h3>{t("Vos courses sont indisponibles")}</h3><button type="button" className="staff-button" onClick={() => void refresh()}>{t("Réessayer")}</button></div> : tab === "history" ? <section><div className="staff-section-heading"><div><h2>{t("Vos missions terminées")}</h2><p>{t("Livraisons confirmées dans cette démo : {count}", {count: history.filter(order => order.status === "delivered").length})}</p></div></div>{history.length ? <div className="courier-history">{history.map(order => <article key={order.id}><span className="courier-history-icon"><PackageCheck size={22} /></span><div><strong>{order.restaurant}</strong><p>{order.id} · {order.city}</p><small>{date(order.updatedAt)}</small></div><span className={`staff-status staff-status-${order.status}`}><span />{t(statusLabels[order.status])}</span>{order.history.some(event => event.status === "accepted") && <div className="courier-history-chat"><button type="button" className="staff-button" aria-expanded={historyChat === order.id} onClick={() => setHistoryChat(historyChat === order.id ? null : order.id)}><MessageSquare size={15} />{historyChat === order.id ? t("Fermer la conversation") : t("Conversation de la commande")}{historyChat !== order.id && (data.unread?.[order.id] || 0) > 0 && <span className="staff-unread">{data.unread[order.id]}</span>}</button>{historyChat === order.id && <OrderChat order={order} language={user.language || "fr"} viewerId={user.id} />}</div>}</article>)}</div> : <div className="staff-empty"><span><History size={30} /></span><h3>{t("Votre historique commence avec la première course")}</h3><p>{t("Les missions livrées et annulées apparaîtront ici.")}</p></div>}</section> : <>
        {currentOrder ? <section aria-label={t("Mission en cours")}><div className="staff-section-heading"><div><h2>{t("Votre mission en cours")}</h2><p>{currentOrder.id} · {t(currentOrder.count > 1 ? "{count} articles" : "{count} article", {count: currentOrder.count})}</p></div><span className={`staff-status staff-status-${currentOrder.status}`}><span />{t(statusLabels[currentOrder.status])}</span></div><article className="courier-mission">
          <ol className="courier-steps" aria-label={t("Étapes de la course")}><li className="is-done"><span><CheckCircle2 size={18} /></span>{t("Course acceptée")}</li><li className={currentOrder.status === "picked_up" ? "is-done" : "is-current"}><span><Store size={18} /></span>{t("Retrait au restaurant")}</li><li className={currentOrder.status === "picked_up" ? "is-current" : ""}><span><MapPin size={18} /></span>{t("Remise au client")}</li></ol>
          <div className="courier-route"><div className="courier-stop"><span className="courier-stop-icon"><Store size={22} /></span><div><small>{t("1 · Retrait")}</small><h3>{currentOrder.restaurant}</h3><p>{currentOrder.pickupAddress}<br />{currentOrder.pickupCity}</p><NavigationLinks destination={{address:currentOrder.pickupAddress,city:currentOrder.pickupCity}} variant="compact"/>{currentOrder.status !== "ready" && currentOrder.status !== "picked_up" && <p className="courier-wait"><Clock3 size={14} />{t("La cuisine prépare encore la commande.")}</p>}</div></div><div className="courier-stop"><span className="courier-stop-icon"><MapPin size={22} /></span><div><small>{t("2 · Livraison")}</small><h3>{currentOrder.customerName}</h3><p>{currentOrder.address}<br />{currentOrder.city}</p><NavigationLinks destination={{address:currentOrder.address,city:currentOrder.city,...currentOrder.deliveryLocation}}/>{currentOrder.eta && <p className={`courier-wait ${isLate(currentOrder.eta, currentOrder.status) ? "urgent" : ""}`}><Clock3 size={14} />{isLate(currentOrder.eta, currentOrder.status) ? t("Attendue depuis {time}", {time: clockLabel(currentOrder.eta)}) : t("Attendue vers {time}", {time: clockLabel(currentOrder.eta)})}</p>}{currentOrder.details && <p className="courier-detail">{currentOrder.details}</p>}{currentOrder.phone && <a href={`tel:${currentOrder.phone.replace(/[^+\d]/g, "")}`}><Phone size={14} />{currentOrder.phone}</a>}</div></div></div>
          <OrderChat order={currentOrder} language={user.language || "fr"} viewerId={user.id} />
          <details className="staff-order-details"><summary>{t("Vérifier le contenu du sac")}<ChevronDown size={16} /></summary><div className="courier-bag"><ul className="staff-order-items">{currentOrder.items.map((item, index) => <li key={`${item.productId}-${index}`}><span className="staff-item-quantity">{item.quantity}×</span><div><strong>{item.name}</strong><small>{item.option}</small></div></li>)}</ul>{currentOrder.notes && <p className="courier-detail">{t("Note du client : {note}", {note: currentOrder.notes})}</p>}</div></details>
          <div className="courier-mission-action">{currentOrder.status === "picked_up" ? <form className="staff-action-form courier-code-form" onSubmit={event => { event.preventDefault(); if (/^\d{4}$/.test(code)) changeStatus(currentOrder, "delivered"); }}><div><KeyRound size={22} /><h3>{t("Remettre la commande")}</h3><p>{t("Demandez le code à 4 chiffres au client au moment de lui remettre sa commande.")}</p></div><label>{t("Code de remise")}<input aria-label={t("Code de remise du client")} value={code} type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} minLength={4} autoComplete="off" placeholder="0000" required disabled={!!busy} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} /></label><button type="submit" className="staff-button staff-button-primary" disabled={!!busy || !/^\d{4}$/.test(code)}><CheckCircle2 size={17} />{busy ? t("Vérification…") : t("Confirmer la livraison")}</button></form> : <><p className="courier-action-copy">{currentOrder.status === "ready" ? t("La commande est prête. Vérifiez son numéro et le contenu du sac avec le restaurant.") : t("Le retrait sera disponible dès que le restaurant aura signalé la commande prête.")}</p><button type="button" className="staff-button staff-button-primary" disabled={!!busy || currentOrder.status !== "ready"} onClick={() => changeStatus(currentOrder, "picked_up")}><ShoppingBag size={17} />{busy ? t("Enregistrement…") : t("J’ai récupéré la commande")}</button><button type="button" className="courier-release" disabled={!!busy} onClick={() => setReleaseOpen(!releaseOpen)}><Undo2 size={14} />{t("Je ne peux pas effectuer cette course")}</button>{releaseOpen && <form className="staff-action-form courier-release-form" onSubmit={event => { event.preventDefault(); if (reason.trim().length >= 3) void mutate(`release-${currentOrder.id}`, () => api(`/api/orders/${encodeURIComponent(currentOrder.id)}/release`, { method: "POST", accountId: user.id, body: JSON.stringify({ reason: reason.trim() }) }), "La course est à nouveau disponible pour un autre livreur."); }}><label>{t("Motif de libération")}<textarea required minLength={3} maxLength={250} value={reason} disabled={!!busy} onChange={event => setReason(event.target.value)} placeholder={t("Expliquez brièvement ce qui vous empêche de poursuivre.")} /></label><p>{t("La commande retourne aux courses disponibles. Le restaurant et l’admin conservent le suivi.")}</p><button type="submit" className="staff-button menu-danger" disabled={!!busy || reason.trim().length < 3}>{t("Libérer cette course")}</button></form>}</>}</div>
        </article></section> : <section aria-label={t("Courses disponibles")}><div className="staff-section-heading"><div><h2>{t("Les courses disponibles")}</h2><p>{data.profile.online ? t("Choisissez une course. Les coordonnées client sont partagées après votre prise en charge.") : t("Votre prochaine course vous attend peut-être.")}</p></div><span className="staff-result-count">{t("Courses disponibles : {count}", {count: data.available.length})}</span></div>{data.available.length ? <div className="courier-offers">{data.available.map(offer => <article className="courier-offer" key={offer.id}><div className="courier-offer-heading"><span><Store size={22} /></span><div><h3>{offer.restaurant}</h3><p>{offer.id}</p></div><span className={`staff-status staff-status-${offer.status}`}><span />{t(statusLabels[offer.status])}</span></div><div className="courier-offer-route"><div><small>{t("Retrait")}</small><strong>{offer.pickupAddress}</strong><p>{offer.pickupCity}</p></div><ArrowRight size={19} /><div><small>{t("Destination")}</small><strong>{offer.city}</strong><p>{t("Adresse après acceptation")}</p></div></div><div className="courier-offer-bottom"><span><ShoppingBag size={15} />{t(offer.count > 1 ? "{count} articles" : "{count} article", {count: offer.count})}</span><small>{t("Frais client : {amount} · démo", {amount: money(offer.delivery)})}</small></div><button type="button" className="staff-button staff-button-primary" disabled={!!busy} onClick={() => void mutate(`claim-${offer.id}`, () => api(`/api/orders/${encodeURIComponent(offer.id)}/claim`, { method: "POST", accountId: user.id, body: "{}" }), "Course acceptée. Consultez les détails de votre mission.")}>{busy === `claim-${offer.id}` ? t("Acceptation…") : t("Prendre cette course")}<ArrowRight size={16} /></button></article>)}</div> : <div className="staff-empty"><span><Bike size={32} /></span><h3>{data.profile.online ? t("Tout est calme pour le moment") : t("Vous êtes en pause")}</h3><p>{data.profile.online ? t("Les commandes apparaissent après acceptation par un restaurant. Cette liste se met à jour automatiquement.") : t("Activez votre disponibilité en haut de l’écran pour voir les courses proposées.")}</p></div>}</section>}
      </>}
      <footer className="staff-footer"><span><span className="staff-live-dot" />{t("Courses actualisées toutes les 8 s")}</span><p>{t("Démo partagée · aucun déplacement ni paiement réel")}</p></footer>
    </main>
  </div>;
}
