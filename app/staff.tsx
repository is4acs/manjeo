import PaymentStatus from "./payment-status";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bike, CheckCircle2, ChefHat, ChevronDown, Clock3, ClipboardList, CreditCard, LogOut, MapPin, MessageSquare, PackageCheck, Phone, RefreshCw, Search, ShieldCheck, ShoppingBag, Store, UserRound, Users, UtensilsCrossed, X } from "lucide-react";
import { api, type User, type Order, type OrderStatus, type CourierProfile, statusLabels } from "@/lib/api";
import { money, type Restaurant } from "@/lib/menu";
import { clockLabel, countdown, isLate, useCountdown } from "./deadline";
import OrderChat from "./order-chat";
import MenuEditor from "./menu-editor";
import Courier from "./courier";
import { t, tEvent, formatDate } from "@/lib/i18n";
import "./staff.css";

type StaffTab = "orders" | "menu" | "restaurants" | "users" | "couriers";
const activeStatuses: OrderStatus[] = ["awaiting_payment", "pending", "accepted", "preparing", "ready", "picked_up"];
const allStatuses: OrderStatus[] = [...activeStatuses, "delivered", "cancelled"];
const nextActions: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  pending: { status: "accepted", label: "Accepter la commande" },
  accepted: { status: "preparing", label: "Commencer la préparation" },
  preparing: { status: "ready", label: "Marquer prête" },
};
const roleLabels = { client: "Client", restaurant: "Restaurateur", admin: "Administrateur", courier: "Livreur" };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const dateLabel = (value: string) => formatDate(value, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const timeLabel = (value: string) => formatDate(value, { hour: "2-digit", minute: "2-digit" });

function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`staff-status staff-status-${status}`}><span />{t(statusLabels[status])}</span>;
}

// Le restaurateur voit le temps qu'il lui reste pour accepter, puis son retard éventuel.
function OrderDeadline({ order, seconds }: { order: Order; seconds: number }) {
  if (order.status === "pending" && order.acceptBy) {
    return <span className={`staff-deadline ${seconds <= 120 ? "urgent" : ""}`}><Clock3 size={14} />{seconds > 0 ? <strong>{t("À accepter sous {time}", {time: countdown(seconds)})}</strong> : <>{t("Délai dépassé — annulation en cours")}</>}</span>;
  }
  if (!order.eta || ["delivered", "cancelled"].includes(order.status)) return null;
  return <span className={`staff-deadline ${isLate(order.eta, order.status) ? "urgent" : ""}`}><Clock3 size={14} />{isLate(order.eta, order.status) ? <>{t("En retard sur {time}", {time: clockLabel(order.eta)})}</> : <strong>{t("Attendue vers {time}", {time: clockLabel(order.eta)})}</strong>}</span>;
}

function OrderCard({ order, admin, busy, onStatus, couriers, onAssign, onRefund, language, unread, viewerId }: { onRefund: (order: Order) => void; order: Order; admin: boolean; busy: boolean; onStatus: (order: Order, status: OrderStatus, reason?: string) => void; couriers: CourierProfile[]; onAssign: (order: Order, courierId: string | null, reason: string) => void; language: string; unread: number; viewerId: string }) {
  const next = nextActions[order.status];
  const seconds = useCountdown(order.status === "pending" ? order.acceptBy : null);
  const expired = order.status === "pending" && !!order.acceptBy && seconds <= 0;
  const [chatOpen, setChatOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [assignReason, setAssignReason] = useState("");
  const [courierId, setCourierId] = useState(order.courierId ?? "");
  const canCancel = !expired && ["awaiting_payment", "pending", "accepted", "preparing", "ready"].includes(order.status);
  const canAssign = admin && ["accepted", "preparing", "ready"].includes(order.status);
  const selectedCourier = couriers.find(courier => courier.id === courierId);
  const courierUnavailable = !!courierId && (!selectedCourier || !selectedCourier.online || !!selectedCourier.activeOrderId && selectedCourier.activeOrderId !== order.id);
  useEffect(() => { setCourierId(order.courierId ?? ""); setAssignReason(""); }, [order.courierId]);
  return <article className={`staff-order ${order.status === "pending" ? "staff-order-new" : ""}`}>
    <div className="staff-order-top">
      <div className="staff-order-id"><strong>{order.id}</strong><span>{dateLabel(order.date)}</span></div>
      <OrderDeadline order={order} seconds={seconds} />
      <StatusBadge status={order.status} />
    </div>
    <div className="staff-order-body">
      <div className="staff-order-content">
        {admin && <p className="staff-order-restaurant"><Store size={15} />{order.restaurant}</p>}
        <h3>{order.customerName}</h3>
        <p className="staff-order-place"><MapPin size={14} />{order.city}<span>·</span>{t(order.count > 1 ? "{count} articles" : "{count} article", {count: order.count})}</p>
        <ul className="staff-order-items">{order.items.map((item, index) => <li key={`${item.productId}-${index}`}><span className="staff-item-quantity">{item.quantity}×</span><div><strong>{item.name}</strong><small>{item.option}</small></div><span>{money(item.price * item.quantity)}</span></li>)}</ul>
        {order.notes && <p className="staff-order-note"><ClipboardList size={16} /><span><strong>{t("Note du client")}</strong>{order.notes}</span></p>}
      </div>
      <div className="staff-order-summary">
        <div className="staff-order-price"><span>{t("Total de la commande")}</span><strong>{money(order.total)}</strong><small>{t("dont {amount} de livraison simulée", {amount: money(order.delivery)})}{order.discount > 0 && <> · {t("remise {code} de {amount}", {code: order.promoCode || "", amount: money(order.discount)})}</>}</small></div>
        {next && <button type="button" className="staff-button staff-button-primary" disabled={busy || expired} onClick={() => onStatus(order, next.status)}>{expired ? t("Délai d’acceptation dépassé") : busy ? t("Mise à jour…") : t(next.label)}{!busy && !expired && <ArrowRight size={16} />}</button>}
        {canCancel && <button type="button" className="staff-cancel" disabled={busy} onClick={() => setCancelOpen(!cancelOpen)}><X size={14} />{t("Annuler la commande")}</button>}
        {order.status === "ready" && <p className="staff-order-complete"><Bike size={17} />{order.courierName ? t("Retrait attendu par {name}", {name: order.courierName}) : t("En attente d’un livreur")}</p>}
        {order.status === "picked_up" && <p className="staff-order-complete"><Bike size={17} />{t("En livraison avec {name}", {name: order.courierName || t("le livreur")})}</p>}
        {order.status === "delivered" && <p className="staff-order-complete"><CheckCircle2 size={17} />{t("Parcours test terminé")}</p>}
      </div>
    </div>
    {cancelOpen && canCancel && <form className="staff-inline-action staff-action-form" onSubmit={event => { event.preventDefault(); if (cancelReason.trim().length >= 3) onStatus(order, "cancelled", cancelReason.trim()); }}><label>{t("Motif d’annulation")}<textarea required minLength={3} maxLength={250} value={cancelReason} disabled={busy} onChange={event => setCancelReason(event.target.value)} placeholder={t("Expliquez le motif au client et à l’équipe.")} /></label><p>{t("L’annulation est définitive et informe tous les espaces concernés.")}</p><div><button type="button" className="staff-button" onClick={() => setCancelOpen(false)} disabled={busy}>{t("Garder la commande")}</button><button type="submit" className="staff-button menu-danger" disabled={busy || cancelReason.trim().length < 3}>{t("Confirmer l’annulation")}</button></div></form>}
    {!["awaiting_payment", "pending"].includes(order.status) && (order.status !== "cancelled" || order.history.some(event => event.status === "accepted")) && <div className="staff-chat">
      <button type="button" className="staff-button" onClick={() => setChatOpen(!chatOpen)}><MessageSquare size={15} />{chatOpen ? t("Fermer la conversation") : t("Conversation avec le client")}{!chatOpen && unread > 0 && <span className="staff-unread">{unread}</span>}</button>
      {chatOpen && <OrderChat order={order} language={language} viewerId={viewerId} />}
    </div>}
    <div className="staff-delivery-strip"><Bike size={16} /><span>{order.courierName ? <strong>{t("Livreur : {name}", {name: order.courierName})}</strong> : order.status === "pending" ? t("La recherche de livreur commence après acceptation.") : order.status === "delivered" || order.status === "cancelled" ? t("Suivi de livraison archivé") : t("Aucun livreur assigné pour le moment")}</span>{order.courierName && <small>{order.status === "picked_up" ? t("Commande récupérée") : order.status === "delivered" ? t("Livraison terminée") : order.status === "cancelled" ? t("Mission annulée") : t("Retrait à venir")}</small>}</div>
    {canAssign && <details className="staff-order-details staff-dispatch"><summary>{order.courierId ? t("Réassigner ou libérer la course") : t("Assigner un livreur")}<ChevronDown size={16} /></summary><form className="staff-action-form" onSubmit={event => { event.preventDefault(); if (!busy && !courierUnavailable && assignReason.trim().length >= 3 && courierId !== (order.courierId ?? "")) onAssign(order, courierId || null, assignReason.trim()); }}><label>{t("Livreur")}<select value={courierId} disabled={busy} onChange={event => setCourierId(event.target.value)}><option value="">{t("Aucun livreur — rendre la course disponible")}</option>{couriers.map(courier => <option key={courier.id} value={courier.id} disabled={courier.id !== order.courierId && (!courier.online || !!courier.activeOrderId && courier.activeOrderId !== order.id)}>{courier.name} · {courier.activeOrderId && courier.activeOrderId !== order.id ? t("En mission") : courier.online ? t("En ligne") : t("En pause")}</option>)}</select></label><label>{t("Motif de l’affectation")}<textarea required minLength={3} maxLength={250} value={assignReason} disabled={busy} onChange={event => setAssignReason(event.target.value)} placeholder={t("Indiquez pourquoi vous changez l’affectation.")} /></label><p>{t("Une seule mission active par livreur. L’affectation est verrouillée après le retrait.")}</p><button type="submit" className="staff-button" disabled={busy || courierUnavailable || assignReason.trim().length < 3 || courierId === (order.courierId ?? "")}>{busy ? t("Enregistrement…") : courierId ? t("Confirmer l’affectation") : t("Libérer la course")}</button></form></details>}
    <PaymentStatus order={order}/>
    {admin && order.payment?.status === 'refund_pending' && <div className="staff-inline-action"><button type="button" className="staff-button" disabled={busy} onClick={() => onRefund(order)}>{t('Demander le remboursement de test')}</button></div>}
    <details className="staff-order-details">
      <summary>{t("Livraison et suivi")}<ChevronDown size={16} /></summary>
      <div className="staff-order-detail-grid">
        <div><h4>{t("Retrait au restaurant")}</h4><p>{order.pickupAddress}<br />{order.pickupCity}</p><h4>{t("Coordonnées de livraison")}</h4><p>{order.address}<br />{order.city}</p>{order.details && <p className="staff-muted">{order.details}</p>}{order.phone ? <a href={`tel:${order.phone.replace(/[^+\d]/g, "")}`}><Phone size={14} />{order.phone}</a> : <p className="staff-muted">{t("Les appels sont disponibles pendant la prise en charge de la commande.")}</p>}</div>
        <div><h4>{t("Historique de la commande")}</h4><ol className="staff-timeline">{order.history.map((event, index) => <li key={`${event.status}-${index}`}><span className="staff-timeline-dot" /><span>{tEvent(event.label || statusLabels[event.status])}{event.actorName && <small className="staff-event-actor">{event.actorName}</small>}</span><time dateTime={event.date}>{dateLabel(event.date)}</time></li>)}</ol></div>
      </div>
    </details>
  </article>;
}

type StaffProps = { user: User; onLogout: () => void; onAccount: () => void; languageControl?: React.ReactNode };

export default function Staff(props: StaffProps) {
  if (props.user.role === "courier") return <Courier key={props.user.id} {...props} />;
  if (props.user.role === "restaurant" || props.user.role === "admin") return <StaffDashboard key={props.user.id} {...props} />;
  throw new Error("A professional workspace requires a professional account.");
}

function StaffDashboard({ user, onLogout, onAccount, languageControl }: StaffProps) {
  const admin = user.role === "admin";
  const [tab, setTab] = useState<StaffTab>("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [couriers, setCouriers] = useState<CourierProfile[]>([]);
  const [menuRestaurantId, setMenuRestaurantId] = useState(user.restaurantId || "");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<string | {source: string; params: Record<string, string | number>}>("");
  const [updated, setUpdated] = useState("");
  const [busyKeys, setBusyKeys] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("active");
  const [restaurantFilter, setRestaurantFilter] = useState("all");
  const [search, setSearch] = useState("");
  const requestSequence = useRef(0);
  const mutations = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    const read = (event: Event) => {
      const detail = (event as CustomEvent<{orderId: string; viewerId: string}>).detail;
      if (detail?.viewerId === user.id) setUnread(current => ({...current, [detail.orderId]: 0}));
    };
    window.addEventListener("manjeo-thread-read", read);
    return () => window.removeEventListener("manjeo-thread-read", read);
  }, [user.id]);

  const refresh = useCallback(async (silent = false, preserveMutationError = false) => {
    if (mutations.current.size) return;
    const sequence = ++requestSequence.current;
    if (!silent) setRefreshing(true);
    try {
      const [orderData, restaurantData, userData, courierData] = await Promise.all([
        api<{ orders: Order[]; unread: Record<string, number> }>("/api/orders", {accountId: user.id}),
        api<{ restaurants: Restaurant[] }>("/api/workspace/restaurants", {accountId: user.id}),
        admin ? api<{ users: User[] }>("/api/users", {accountId: user.id}) : Promise.resolve({ users: [] as User[] }),
        admin ? api<{ couriers: CourierProfile[] }>("/api/couriers", {accountId: user.id}) : Promise.resolve({ couriers: [] as CourierProfile[] }),
      ]);
      if (!mounted.current || sequence !== requestSequence.current) return;
      setOrders(orderData.orders); setUnread(orderData.unread || {});
      setRestaurants(restaurantData.restaurants);
      setUsers(userData.users);
      setCouriers(courierData.couriers);
      setUpdated(new Date().toISOString());
      if (!preserveMutationError) setError("");
    } catch (cause) {
      if (mounted.current && sequence === requestSequence.current) setError(current => preserveMutationError && current ? current : cause instanceof Error ? cause.message : "Le chargement a échoué. Réessayez.");
    } finally {
      if (mounted.current && sequence === requestSequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [admin, user.id]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 8000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { mounted.current = false; ++requestSequence.current; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4500); return () => window.clearTimeout(timer); }, [notice]);

  async function mutate(key: string, action: () => Promise<void>, message: string | {source: string; params: Record<string, string | number>}) {
    if (mutations.current.has(key)) return;
    mutations.current.add(key);
    ++requestSequence.current;
    setRefreshing(false);
    setBusyKeys([...mutations.current]);
    setError(""); setNotice("");
    try { await action(); if (mounted.current) { setNotice(message); setUpdated(new Date().toISOString()); } }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "La modification n’a pas été enregistrée."); }
    finally {
      mutations.current.delete(key);
      if (mounted.current) {
        setBusyKeys([...mutations.current]);
        // Even a lost HTTP response may follow a committed action. Re-read the
        // shared state after the last pending action, preserving its error.
        if (!mutations.current.size) void refresh(true, true);
      }
    }
  }

  function changeStatus(order: Order, status: OrderStatus, reason?: string) {
    void mutate(`order-${order.id}`, async () => {
      const data = await api<{ order: Order }>(`/api/orders/${encodeURIComponent(order.id)}`, { method: "PATCH", accountId: user.id, body: JSON.stringify({ status, ...(reason ? { reason } : {}) }) });
      if (mounted.current) setOrders(current => current.map(item => item.id === order.id ? data.order : item));
    }, {source: "{id} · {status}", params: {id: order.id, status: statusLabels[status]}});
  }

  function toggleRestaurant(restaurant: Restaurant) {
    const acceptingOrders = !restaurant.acceptingOrders;
    void mutate(`restaurant-${restaurant.id}`, async () => {
      const data = await api<{ restaurant: Restaurant }>(`/api/restaurants/${encodeURIComponent(restaurant.id)}`, { method: "PATCH", accountId: user.id, body: JSON.stringify({ acceptingOrders }) });
      if (mounted.current) setRestaurants(current => current.map(item => item.id === restaurant.id ? { ...item, acceptingOrders: data.restaurant.acceptingOrders } : item));
    }, {source: acceptingOrders ? "{name} accepte les commandes." : "{name} est en pause.", params: {name: restaurant.name}});
  }

  function refundPayment(order: Order) {
    void mutate(`order-${order.id}`, async () => {
      await api(`/api/orders/${encodeURIComponent(order.id)}/refund`, {method:'POST', accountId: user.id, body:'{}'});
    }, 'Demande envoyée. La confirmation du remboursement apparaîtra après le retour de Stripe.');
  }
  function assignCourier(order: Order, courierId: string | null, reason: string) {
    void mutate(`order-${order.id}`, async () => {
      const data = await api<{ order: Order }>(`/api/orders/${encodeURIComponent(order.id)}/assign`, { method: "POST", accountId: user.id, body: JSON.stringify({ courierId, reason }) });
      if (mounted.current) setOrders(current => current.map(item => item.id === order.id ? data.order : item));
    }, courierId ? "L’affectation du livreur est enregistrée." : "La course est à nouveau disponible.");
  }

  const ownRestaurant = restaurants.find(item => item.id === user.restaurantId);
  const menuRestaurant = restaurants.find(item => item.id === (admin ? menuRestaurantId || restaurants[0]?.id : user.restaurantId));
  const activeOrders = orders.filter(order => activeStatuses.includes(order.status));
  const pendingCount = orders.filter(order => order.status === "pending").length;
  const delivered = orders.filter(order => order.status === "delivered");
  const totalSales = delivered.reduce((sum, order) => sum + (admin ? order.total : order.subtotal), 0);
  const visibleOrders = useMemo(() => orders.filter(order => {
    const statusMatch = statusFilter === "all" || (statusFilter === "active" ? activeStatuses.includes(order.status) : order.status === statusFilter);
    return statusMatch && (restaurantFilter === "all" || order.restaurantId === restaurantFilter) && normalize(`${order.id} ${order.customerName} ${order.restaurant} ${order.city}`).includes(normalize(search.trim()));
  }).sort((a, b) => b.date.localeCompare(a.date)), [orders, statusFilter, restaurantFilter, search]);
  const tabs: { id: StaffTab; label: string; icon: typeof ClipboardList }[] = admin
    ? [{ id: "orders", label: "Commandes", icon: ClipboardList }, { id: "couriers", label: "Livreurs", icon: Bike }, { id: "restaurants", label: "Restaurants", icon: Store }, { id: "menu", label: "Cartes", icon: UtensilsCrossed }, { id: "users", label: "Comptes", icon: Users }]
    : [{ id: "orders", label: "Commandes", icon: ClipboardList }, { id: "menu", label: "Ma carte", icon: UtensilsCrossed }];

  return <div className="staff-app">
    <header className="staff-header"><div className="staff-header-inner">
      <span className="staff-brand">manjéo</span>
      <span className="staff-space-label">{admin ? <ShieldCheck size={17} /> : <ChefHat size={18} />}{admin ? t("Administration") : t("Espace restaurateur")}</span>
      <div className="staff-header-actions"><button type="button" className="staff-shop-link" onClick={onAccount} aria-label={t("Mon compte")}><UserRound size={15} /><span>{t("Mon compte")}</span></button><button type="button" className="staff-logout" onClick={onLogout} aria-label={t("Déconnexion")}><LogOut size={16} /><span>{t("Déconnexion")}</span></button>{languageControl}</div>
    </div></header>

    <main className="staff-main">
      <section className="staff-welcome">
        <div><p className="staff-eyebrow">{admin ? t("MANJÉO · VUE D’ENSEMBLE") : t("VOTRE CUISINE, EN DIRECT")}</p><h1>{admin ? t("Tout se passe ici.") : ownRestaurant?.name ?? t("Votre restaurant")}</h1><p>{admin ? t("Coordonnez clients, cuisines et livreurs sur un même parcours.") : t("Une nouvelle commande ? À vous de jouer.")}</p></div>
        <div className="staff-user-card"><span className="staff-avatar">{admin ? <ShieldCheck size={22} /> : <ChefHat size={24} />}</span><div><strong>{user.name}</strong><span>{t("{role} · compte démo", {role: t(roleLabels[user.role])})}</span></div></div>
      </section>

      {!admin && ownRestaurant && <section className={`staff-service ${ownRestaurant.acceptingOrders ? "staff-service-open" : "staff-service-paused"}`} aria-label={t("Réception des commandes")}><div><span className="staff-service-dot" /><div><strong>{ownRestaurant.acceptingOrders ? t("Vous recevez les commandes") : t("La réception des commandes est en pause")}</strong><p>{ownRestaurant.acceptingOrders ? t("Votre carte est ouverte dans la vitrine client.") : t("Les commandes déjà reçues restent à traiter.")}</p></div></div><button type="button" role="switch" aria-checked={ownRestaurant.acceptingOrders} aria-label={t("Accepter de nouvelles commandes")} disabled={busyKeys.includes(`restaurant-${ownRestaurant.id}`)} className="staff-switch" onClick={() => toggleRestaurant(ownRestaurant)}><span /></button></section>}

      <section className="staff-stats" aria-label={t("Indicateurs de la démonstration")}>
        <div className="staff-stat"><span className="staff-stat-icon staff-stat-orange"><Clock3 size={21} /></span><div><span>{t("À accepter")}</span><strong>{loading ? "—" : pendingCount}</strong></div>{pendingCount > 0 && <span className="staff-stat-label">{t("À vous de jouer")}</span>}</div>
        <div className="staff-stat"><span className="staff-stat-icon"><ShoppingBag size={21} /></span><div><span>{t("En cours")}</span><strong>{loading ? "—" : activeOrders.length}</strong></div><small>{t("De la réception à la livraison")}</small></div>
        <div className="staff-stat"><span className="staff-stat-icon staff-stat-green"><CreditCard size={21} /></span><div><span>{admin ? t("Total livré simulé") : t("Ventes livrées simulées")}</span><strong>{loading ? "—" : money(totalSales)}</strong></div><small>{t(delivered.length !== 1 ? "{count} commandes" : "{count} commande", {count: delivered.length})}{!admin && <> · {t("hors livraison")}</>}</small></div>
      </section>

      <div className="staff-navigation"><nav aria-label={t("Gestion")}><div className="staff-tabs">{tabs.map(item => <button type="button" key={item.id} className={tab === item.id ? "staff-tab staff-tab-active" : "staff-tab"} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}><item.icon size={17} />{t(item.label)}{item.id === "orders" && pendingCount > 0 && <span>{pendingCount}</span>}</button>)}</div></nav><button type="button" className="staff-refresh" onClick={() => void refresh()} disabled={refreshing || busyKeys.length > 0} aria-label={t("Actualiser les données")}><RefreshCw size={15} className={refreshing ? "staff-spinning" : ""} /><span>{refreshing ? t("Actualisation…") : t("Actualiser")}</span></button></div>

      {error && <div className="staff-alert" role="alert"><span>{t(error)}</span><button type="button" onClick={() => void refresh()}>{t("Réessayer")}</button></div>}
      {loading ? <div className="staff-loading" role="status"><RefreshCw size={23} className="staff-spinning" /><p>{t("Ouverture de votre espace…")}</p></div> : <>
        {tab === "orders" && <section aria-label={t("Liste des commandes")}>
          <div className="staff-section-heading"><div><h2>{t("Les commandes")}</h2><p>{admin ? t("Un suivi partagé pour tous les restaurants.") : t("Acceptez, préparez, puis signalez que tout est prêt.")}</p></div><span className="staff-result-count">{t(visibleOrders.length !== 1 ? "{count} résultats" : "{count} résultat", {count: visibleOrders.length})}</span></div>
          {admin && orders.some(order => ['refund_pending', 'refund_failed'].includes(order.payment?.status || '')) && <div className="staff-help"><p>{t('Des remboursements de test nécessitent votre attention.')}</p><button type="button" className="staff-button" onClick={() => {setStatusFilter('all'); setRestaurantFilter('all'); setSearch('');}}>{t('Voir toutes les commandes')}</button></div>}
          <div className="staff-filters"><label className="staff-search"><Search size={17} /><input aria-label={t("Rechercher une commande")} placeholder={t("Nom, numéro, ville…")} value={search} onChange={event => setSearch(event.target.value)} /></label><label className="staff-select"><span>{t("Statut")}</span><select aria-label={t("Statut")} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="active">{t("En cours")}</option><option value="all">{t("Toutes les commandes")}</option>{allStatuses.map(status => <option key={status} value={status}>{t(statusLabels[status])}</option>)}</select><ChevronDown size={14} /></label>{admin && <label className="staff-select"><span>{t("Restaurant")}</span><select aria-label={t("Restaurant")} value={restaurantFilter} onChange={event => setRestaurantFilter(event.target.value)}><option value="all">{t("Tous les restaurants")}</option>{restaurants.map(restaurant => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>)}</select><ChevronDown size={14} /></label>}</div>
          {visibleOrders.length ? <div className="staff-orders">{visibleOrders.map(order => <OrderCard key={order.id} order={order} admin={admin} busy={busyKeys.includes(`order-${order.id}`)} onStatus={changeStatus} couriers={couriers} onAssign={assignCourier} onRefund={refundPayment} language={user.language || "fr"} unread={unread[order.id] || 0} viewerId={user.id} />)}</div> : <div className="staff-empty"><span><PackageCheck size={32} /></span><h3>{orders.length ? t("Aucune commande avec ces filtres") : t("La première commande se prépare ici")}</h3><p>{orders.length ? t("Essayez un autre statut ou effacez votre recherche.") : t("Connectez-vous avec le compte client pour passer une commande test. Elle apparaîtra ici automatiquement.")}</p>{orders.length > 0 ? <button type="button" className="staff-button" onClick={() => { setSearch(""); setStatusFilter("all"); setRestaurantFilter("all"); }}>{t("Voir toutes les commandes")}</button> : <span className="staff-empty-account">client@manjeo.test</span>}</div>}
        </section>}

        {menuRestaurant && <section hidden={tab !== "menu"} aria-label={t("Gestion des cartes")}>{admin && <label className="staff-menu-selector">{t("Restaurant à modifier")}<select value={menuRestaurant.id} onChange={event => setMenuRestaurantId(event.target.value)}>{restaurants.map(restaurant => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>)}</select></label>}<MenuEditor key={menuRestaurant.id} restaurant={menuRestaurant} viewerId={user.id} onRestaurantChange={(restaurant, fields) => { ++requestSequence.current; setRefreshing(false); const saved = Object.fromEntries(fields.map(field => [field, restaurant[field]])); setRestaurants(current => current.map(item => item.id === restaurant.id ? { ...item, ...saved } : item)); }} /></section>}

        {tab === "couriers" && admin && <section aria-label={t("Activité des livreurs")}><div className="staff-section-heading"><div><h2>{t("Les livreurs, en direct")}</h2><p>{t("{count} disponibles · une mission active par livreur.", {count: couriers.filter(courier => courier.online && !courier.activeOrderId).length})}</p></div></div><div className="staff-couriers">{couriers.map(courier => { const mission = orders.find(order => order.id === courier.activeOrderId); return <article className="staff-courier" key={courier.id}><span className="staff-avatar"><Bike size={25} /></span><div><h3>{courier.name}</h3><p>{courier.email}</p><span className={`staff-status ${courier.activeOrderId ? "staff-status-picked_up" : courier.online ? "staff-status-ready" : "staff-status-pending"}`}><span />{courier.activeOrderId ? t("En mission") : courier.online ? t("Disponible") : t("En pause")}</span>{mission ? <p className="staff-courier-mission">{mission.restaurant} → {mission.city}<br /><strong>{t(statusLabels[mission.status])}</strong></p> : <p className="staff-courier-mission">{courier.online ? t("Peut prendre une nouvelle course") : t("Les nouvelles attributions sont en pause")}</p>}{courier.activeOrderId && <button type="button" className="staff-button" onClick={() => { setSearch(courier.activeOrderId || ""); setStatusFilter("all"); setRestaurantFilter("all"); setTab("orders"); }}>{t("Voir la mission")}<ArrowRight size={14} /></button>}</div></article>; })}</div>{!couriers.length && <div className="staff-empty"><span><Bike size={29} /></span><h3>{t("Aucun livreur pour le moment")}</h3><p>{t("Les comptes livreur apparaissent ici avec leur disponibilité.")}</p></div>}<p className="staff-help"><Bike size={17} />{t("Depuis une commande acceptée, attribuez ou réattribuez une course à un livreur disponible. Après le retrait, seul ce livreur peut confirmer la livraison avec le code client.")}</p></section>}

        {tab === "restaurants" && <section aria-label={t("Gestion des restaurants")}><div className="staff-section-heading"><div><h2>{t("Les restaurants partenaires")}</h2><p>{t("{count} restaurants ouverts aux commandes test.", {count: restaurants.filter(restaurant => restaurant.acceptingOrders).length})}</p></div><span className="staff-result-count">{t("{count} restaurants fictifs", {count: restaurants.length})}</span></div><div className="staff-restaurants">{restaurants.map(restaurant => <article className="staff-restaurant" key={restaurant.id}><img src={restaurant.image} alt="" /><div className="staff-restaurant-info"><span className="staff-category">{restaurant.category}</span><h3>{restaurant.name}</h3><p>{t("{count} produits disponibles · {minutes} min", {count: restaurant.products.filter(product => product.available).length, minutes: restaurant.minutes})}</p><button type="button" className="staff-button staff-edit-menu" onClick={() => { setMenuRestaurantId(restaurant.id); setTab("menu"); }}><UtensilsCrossed size={14} />{t("Gérer la carte")}</button><div className="staff-restaurant-toggle"><span className={restaurant.acceptingOrders ? "staff-open-label" : "staff-paused-label"}>{restaurant.acceptingOrders ? t("Ouvert aux commandes") : t("Commandes en pause")}</span><button type="button" role="switch" aria-checked={restaurant.acceptingOrders} aria-label={t("{name} : accepter les commandes", {name: restaurant.name})} className="staff-switch" disabled={busyKeys.includes(`restaurant-${restaurant.id}`)} onClick={() => toggleRestaurant(restaurant)}><span /></button></div></div></article>)}</div><p className="staff-help"><Store size={16} />{t("Mettre un restaurant en pause bloque les nouvelles commandes. Les commandes reçues restent accessibles.")}</p></section>}

        {tab === "users" && <section aria-label={t("Comptes de démonstration")}><div className="staff-section-heading"><div><h2>{t("Un compte pour chaque rôle")}</h2><p>{t("Quatre espaces reliés, du choix du repas à sa remise.")}</p></div><span className="staff-result-count">{t("{count} comptes", {count: users.length})}</span></div><div className="staff-role-summary">{(["client", "restaurant", "courier", "admin"] as const).map(role => <span key={role}>{t(roleLabels[role])}<strong>{users.filter(account => account.role === role).length}</strong></span>)}</div><div className="staff-accounts">{users.map(account => <article className="staff-account" key={account.id}><span className={`staff-account-icon staff-account-${account.role}`}>{account.role === "admin" ? <ShieldCheck size={23} /> : account.role === "restaurant" ? <ChefHat size={24} /> : account.role === "courier" ? <Bike size={24} /> : <ShoppingBag size={23} />}</span><div><span className="staff-account-role">{t(roleLabels[account.role])}</span><h3>{account.name}</h3><p>{account.email}</p><small>{account.role === "restaurant" ? restaurants.find(restaurant => restaurant.id === account.restaurantId)?.name ?? t("Restaurant associé") : account.role === "admin" ? t("Accès à tous les restaurants et commandes") : account.role === "courier" ? t("Courses, retrait et confirmation de remise") : t("Commande et suivi de ses commandes")}</small></div>{account.id === user.id && <span className="staff-you">{t("Vous")}</span>}</article>)}</div><div className="staff-account-tip"><Users size={21} /><div><strong>{t("Testez le parcours de bout en bout")}</strong><p>{t("Déconnectez-vous pour changer de rôle : commandez côté client, préparez côté restaurant, récupérez et livrez côté livreur avec le code affiché au client. L’admin supervise l’ensemble.")}</p></div></div></section>}
      </>}

      <footer className="staff-footer"><span><span className="staff-live-dot" />{updated ? t("Actualisé à {time} · toutes les 8 s", {time: timeLabel(updated)}) : t("Données partagées")}</span><p>{t("Démo en ligne · aucun paiement ni livraison réelle")}</p></footer>
    </main>
    {notice && <div className="staff-toast" role="status"><CheckCircle2 size={18} />{typeof notice === "string" ? t(notice) : t(notice.source, {...notice.params, ...(notice.params.status ? {status: t(String(notice.params.status))} : {})})}</div>}
  </div>;
}
