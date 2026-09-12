import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bike, CheckCircle2, ChevronDown, Clock3, History, KeyRound, LogOut, MapPin, PackageCheck, Phone, RefreshCw, ShoppingBag, Store, Undo2 } from "lucide-react";
import { api, type CourierProfile, type DeliveryOffer, type Order, type User, statusLabels } from "@/lib/api";
import { money } from "@/lib/menu";
import "./staff.css";
import "./courier.css";

type CourierData = { available: DeliveryOffer[]; assigned: Order[]; profile: CourierProfile };
const activeStatus = (order: Order) => order.status !== "delivered" && order.status !== "cancelled";
const date = (value: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "America/Cayenne", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export default function Courier({ user, onLogout, onShop }: { user: User; onLogout: () => void; onShop: () => void }) {
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
  const mounted = useRef(true);
  const mutating = useRef(false);
  const sequence = useRef(0);

  const refresh = useCallback(async (silent = false, force = false) => {
    if (mutating.current && !force) return;
    const current = ++sequence.current;
    if (!silent) setRefreshing(true);
    try {
      const result = await api<CourierData>("/api/deliveries");
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
    void mutate(`status-${order.id}`, () => api(`/api/orders/${encodeURIComponent(order.id)}`, { method: "PATCH", body: JSON.stringify({ status, ...(status === "delivered" ? { deliveryCode: code } : {}) }) }), status === "picked_up" ? "Retrait confirmé. Le client est informé du départ en livraison." : "Livraison confirmée. La mission est terminée.");
  }
  return <div className="staff-app courier-app">
    <header className="staff-header"><div className="staff-header-inner"><button type="button" className="staff-brand" onClick={onShop} aria-label="Manjéo, voir la vitrine">manjéo<span>•</span></button><span className="staff-space-label"><Bike size={19} />Espace livreur</span><div className="staff-header-actions"><button type="button" className="staff-shop-link" onClick={onShop} aria-label="Voir la vitrine"><ArrowLeft size={15} /><span>Voir la vitrine</span></button><button type="button" className="staff-logout" onClick={onLogout} aria-label="Déconnexion"><LogOut size={16} /><span>Déconnexion</span></button></div></div></header>
    <main className="staff-main">
      <section className="staff-welcome"><div><p className="staff-eyebrow">LE DERNIER KILOMÈTRE, ENSEMBLE</p><h1>Bonjour, {user.name.split(" ")[0]}.</h1><p>Une course à la fois, de la cuisine à la remise au client.</p></div><span className="staff-avatar"><Bike size={25} /></span></section>
      {data && <section className={`staff-service ${data.profile.online ? "staff-service-open" : "staff-service-paused"}`} aria-label="Disponibilité du livreur"><div><span className="staff-service-dot" /><div><strong>{data.profile.online ? "Vous êtes en ligne" : "Vous êtes en pause"}</strong><p>{currentOrder ? "Votre mission reste à terminer, même en pause." : data.profile.online ? "Les nouvelles courses disponibles apparaissent ci-dessous." : "Passez en ligne pour recevoir des propositions de course."}</p></div></div><button type="button" role="switch" className="staff-switch" aria-checked={data.profile.online} aria-label="Être disponible pour les courses" disabled={!!busy} onClick={() => void mutate("profile", () => api("/api/courier/profile", { method: "PATCH", body: JSON.stringify({ online: !data.profile.online }) }), data.profile.online ? "Vous êtes en pause." : "Vous êtes en ligne.")}><span /></button></section>}
      <div className="staff-navigation"><nav aria-label="Courses"><div className="staff-tabs"><button type="button" className={`staff-tab ${tab === "missions" ? "staff-tab-active" : ""}`} aria-current={tab === "missions" ? "page" : undefined} onClick={() => setTab("missions")}><Bike size={17} />Mes courses{currentOrder && <span>1</span>}</button><button type="button" className={`staff-tab ${tab === "history" ? "staff-tab-active" : ""}`} aria-current={tab === "history" ? "page" : undefined} onClick={() => setTab("history")}><History size={17} />Historique</button></div></nav><button type="button" className="staff-refresh" disabled={!!busy || refreshing} onClick={() => void refresh()} aria-label="Actualiser les courses"><RefreshCw size={16} className={refreshing ? "staff-spinning" : ""} /><span>Actualiser</span></button></div>
      {error && <div className="staff-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>Fermer</button></div>}{notice && <p className="courier-notice" role="status"><CheckCircle2 size={17} />{notice}</p>}
      {loading ? <div className="staff-loading" role="status"><RefreshCw className="staff-spinning" size={24} /><p>Chargement de votre espace…</p></div> : !data ? <div className="staff-empty"><h3>Vos courses sont indisponibles</h3><button type="button" className="staff-button" onClick={() => void refresh()}>Réessayer</button></div> : tab === "history" ? <section><div className="staff-section-heading"><div><h2>Vos missions terminées</h2><p>{history.filter(order => order.status === "delivered").length} livraison{history.filter(order => order.status === "delivered").length > 1 ? "s" : ""} confirmée{history.filter(order => order.status === "delivered").length > 1 ? "s" : ""} dans cette démo.</p></div></div>{history.length ? <div className="courier-history">{history.map(order => <article key={order.id}><span className="courier-history-icon"><PackageCheck size={22} /></span><div><strong>{order.restaurant}</strong><p>{order.id} · {order.city}</p><small>{date(order.updatedAt)}</small></div><span className={`staff-status staff-status-${order.status}`}><span />{statusLabels[order.status]}</span></article>)}</div> : <div className="staff-empty"><span><History size={30} /></span><h3>Votre historique commence avec la première course</h3><p>Les missions livrées et annulées apparaîtront ici.</p></div>}</section> : <>
        {currentOrder ? <section aria-label="Mission en cours"><div className="staff-section-heading"><div><h2>Votre mission en cours</h2><p>{currentOrder.id} · {currentOrder.count} article{currentOrder.count > 1 ? "s" : ""}</p></div><span className={`staff-status staff-status-${currentOrder.status}`}><span />{statusLabels[currentOrder.status]}</span></div><article className="courier-mission">
          <ol className="courier-steps" aria-label="Étapes de la course"><li className="is-done"><span><CheckCircle2 size={18} /></span>Course acceptée</li><li className={currentOrder.status === "picked_up" ? "is-done" : "is-current"}><span><Store size={18} /></span>Retrait au restaurant</li><li className={currentOrder.status === "picked_up" ? "is-current" : ""}><span><MapPin size={18} /></span>Remise au client</li></ol>
          <div className="courier-route"><div className="courier-stop"><span className="courier-stop-icon"><Store size={22} /></span><div><small>1 · Retrait</small><h3>{currentOrder.restaurant}</h3><p>{currentOrder.pickupAddress}<br />{currentOrder.pickupCity}</p>{currentOrder.status !== "ready" && currentOrder.status !== "picked_up" && <p className="courier-wait"><Clock3 size={14} />La cuisine prépare encore la commande.</p>}</div></div><div className="courier-stop"><span className="courier-stop-icon"><MapPin size={22} /></span><div><small>2 · Livraison</small><h3>{currentOrder.customerName}</h3><p>{currentOrder.address}<br />{currentOrder.city}</p>{currentOrder.details && <p className="courier-detail">{currentOrder.details}</p>}<a href={`tel:${currentOrder.phone.replace(/[^+\d]/g, "")}`}><Phone size={14} />{currentOrder.phone}</a></div></div></div>
          <details className="staff-order-details"><summary>Vérifier le contenu du sac<ChevronDown size={16} /></summary><div className="courier-bag"><ul className="staff-order-items">{currentOrder.items.map((item, index) => <li key={`${item.productId}-${index}`}><span className="staff-item-quantity">{item.quantity}×</span><div><strong>{item.name}</strong><small>{item.option}</small></div></li>)}</ul>{currentOrder.notes && <p className="courier-detail">Note du client : {currentOrder.notes}</p>}</div></details>
          <div className="courier-mission-action">{currentOrder.status === "picked_up" ? <form className="staff-action-form courier-code-form" onSubmit={event => { event.preventDefault(); if (/^\d{4}$/.test(code)) changeStatus(currentOrder, "delivered"); }}><div><KeyRound size={22} /><h3>Remettre la commande</h3><p>Demandez le code à 4 chiffres au client au moment de lui remettre sa commande.</p></div><label>Code de remise<input aria-label="Code de remise du client" value={code} type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} minLength={4} autoComplete="off" placeholder="0000" required disabled={!!busy} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} /></label><button type="submit" className="staff-button staff-button-primary" disabled={!!busy || !/^\d{4}$/.test(code)}><CheckCircle2 size={17} />{busy ? "Vérification…" : "Confirmer la livraison"}</button></form> : <><p className="courier-action-copy">{currentOrder.status === "ready" ? "La commande est prête. Vérifiez son numéro et le contenu du sac avec le restaurant." : "Le retrait sera disponible dès que le restaurant aura signalé la commande prête."}</p><button type="button" className="staff-button staff-button-primary" disabled={!!busy || currentOrder.status !== "ready"} onClick={() => changeStatus(currentOrder, "picked_up")}><ShoppingBag size={17} />{busy ? "Enregistrement…" : "J’ai récupéré la commande"}</button><button type="button" className="courier-release" disabled={!!busy} onClick={() => setReleaseOpen(!releaseOpen)}><Undo2 size={14} />Je ne peux pas effectuer cette course</button>{releaseOpen && <form className="staff-action-form courier-release-form" onSubmit={event => { event.preventDefault(); if (reason.trim().length >= 3) void mutate(`release-${currentOrder.id}`, () => api(`/api/orders/${encodeURIComponent(currentOrder.id)}/release`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }), "La course est à nouveau disponible pour un autre livreur."); }}><label>Motif de libération<textarea required minLength={3} maxLength={250} value={reason} disabled={!!busy} onChange={event => setReason(event.target.value)} placeholder="Expliquez brièvement ce qui vous empêche de poursuivre." /></label><p>La commande retourne aux courses disponibles. Le restaurant et l’admin conservent le suivi.</p><button type="submit" className="staff-button menu-danger" disabled={!!busy || reason.trim().length < 3}>Libérer cette course</button></form>}</>}</div>
        </article></section> : <section aria-label="Courses disponibles"><div className="staff-section-heading"><div><h2>Les courses disponibles</h2><p>{data.profile.online ? "Choisissez une course. Les coordonnées client sont partagées après votre prise en charge." : "Votre prochaine course vous attend peut-être."}</p></div><span className="staff-result-count">{data.available.length} disponible{data.available.length > 1 ? "s" : ""}</span></div>{data.available.length ? <div className="courier-offers">{data.available.map(offer => <article className="courier-offer" key={offer.id}><div className="courier-offer-heading"><span><Store size={22} /></span><div><h3>{offer.restaurant}</h3><p>{offer.id}</p></div><span className={`staff-status staff-status-${offer.status}`}><span />{statusLabels[offer.status]}</span></div><div className="courier-offer-route"><div><small>Retrait</small><strong>{offer.pickupAddress}</strong><p>{offer.pickupCity}</p></div><ArrowRight size={19} /><div><small>Destination</small><strong>{offer.city}</strong><p>Adresse après acceptation</p></div></div><div className="courier-offer-bottom"><span><ShoppingBag size={15} />{offer.count} article{offer.count > 1 ? "s" : ""}</span><small>Frais client : {money(offer.delivery)} · démo</small></div><button type="button" className="staff-button staff-button-primary" disabled={!!busy} onClick={() => void mutate(`claim-${offer.id}`, () => api(`/api/orders/${encodeURIComponent(offer.id)}/claim`, { method: "POST", body: "{}" }), "Course acceptée. Consultez les détails de votre mission.")}>{busy === `claim-${offer.id}` ? "Acceptation…" : "Prendre cette course"}<ArrowRight size={16} /></button></article>)}</div> : <div className="staff-empty"><span><Bike size={32} /></span><h3>{data.profile.online ? "Tout est calme pour le moment" : "Vous êtes en pause"}</h3><p>{data.profile.online ? "Les commandes apparaissent après acceptation par un restaurant. Cette liste se met à jour automatiquement." : "Activez votre disponibilité en haut de l’écran pour voir les courses proposées."}</p></div>}</section>}
      </>}
      <footer className="staff-footer"><span><span className="staff-live-dot" />Courses actualisées toutes les 8 s</span><p>Démo partagée · aucun déplacement ni paiement réel</p></footer>
    </main>
  </div>;
}
