import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bike, CheckCircle2, ChefHat, ChevronDown, Clock3, ClipboardList, CreditCard, LogOut, MapPin, PackageCheck, Phone, RefreshCw, Search, ShieldCheck, ShoppingBag, Store, Users, UtensilsCrossed, X } from "lucide-react";
import { api, type User, type Order, type OrderStatus, type CourierProfile, statusLabels } from "@/lib/api";
import { money, type Restaurant } from "@/lib/menu";
import MenuEditor from "./menu-editor";
import Courier from "./courier";
import "./staff.css";

type StaffTab = "orders" | "menu" | "restaurants" | "users" | "couriers";
const activeStatuses: OrderStatus[] = ["pending", "accepted", "preparing", "ready", "picked_up"];
const allStatuses: OrderStatus[] = [...activeStatuses, "delivered", "cancelled"];
const nextActions: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  pending: { status: "accepted", label: "Accepter la commande" },
  accepted: { status: "preparing", label: "Commencer la préparation" },
  preparing: { status: "ready", label: "Marquer prête" },
};
const roleLabels = { client: "Client", restaurant: "Restaurateur", admin: "Administrateur", courier: "Livreur" };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const dateLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "America/Cayenne", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const timeLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "America/Cayenne", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`staff-status staff-status-${status}`}><span />{statusLabels[status]}</span>;
}

function OrderCard({ order, admin, busy, onStatus, couriers, onAssign }: { order: Order; admin: boolean; busy: boolean; onStatus: (order: Order, status: OrderStatus, reason?: string) => void; couriers: CourierProfile[]; onAssign: (order: Order, courierId: string | null, reason: string) => void }) {
  const next = nextActions[order.status];
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [assignReason, setAssignReason] = useState("");
  const [courierId, setCourierId] = useState(order.courierId ?? "");
  const canCancel = ["pending", "accepted", "preparing", "ready"].includes(order.status);
  const canAssign = admin && ["accepted", "preparing", "ready"].includes(order.status);
  useEffect(() => { setCourierId(order.courierId ?? ""); setAssignReason(""); }, [order.courierId]);
  return <article className={`staff-order ${order.status === "pending" ? "staff-order-new" : ""}`}>
    <div className="staff-order-top">
      <div className="staff-order-id"><strong>{order.id}</strong><span>{dateLabel(order.date)}</span></div>
      <StatusBadge status={order.status} />
    </div>
    <div className="staff-order-body">
      <div className="staff-order-content">
        {admin && <p className="staff-order-restaurant"><Store size={15} />{order.restaurant}</p>}
        <h3>{order.customerName}</h3>
        <p className="staff-order-place"><MapPin size={14} />{order.city}<span>·</span>{order.count} article{order.count > 1 ? "s" : ""}</p>
        <ul className="staff-order-items">{order.items.map((item, index) => <li key={`${item.productId}-${index}`}><span className="staff-item-quantity">{item.quantity}×</span><div><strong>{item.name}</strong><small>{item.option}</small></div><span>{money(item.price * item.quantity)}</span></li>)}</ul>
        {order.notes && <p className="staff-order-note"><ClipboardList size={16} /><span><strong>Note du client</strong>{order.notes}</span></p>}
      </div>
      <div className="staff-order-summary">
        <div className="staff-order-price"><span>Total de la commande</span><strong>{money(order.total)}</strong><small>dont {money(order.delivery)} de livraison simulée</small></div>
        {next && <button type="button" className="staff-button staff-button-primary" disabled={busy} onClick={() => onStatus(order, next.status)}>{busy ? "Mise à jour…" : next.label}{!busy && <ArrowRight size={16} />}</button>}
        {canCancel && <button type="button" className="staff-cancel" disabled={busy} onClick={() => setCancelOpen(!cancelOpen)}><X size={14} />Annuler la commande</button>}
        {order.status === "ready" && <p className="staff-order-complete"><Bike size={17} />{order.courierName ? `Retrait attendu par ${order.courierName}` : "En attente d’un livreur"}</p>}
        {order.status === "picked_up" && <p className="staff-order-complete"><Bike size={17} />En livraison avec {order.courierName || "le livreur"}</p>}
        {order.status === "delivered" && <p className="staff-order-complete"><CheckCircle2 size={17} />Parcours test terminé</p>}
      </div>
    </div>
    {cancelOpen && canCancel && <form className="staff-inline-action staff-action-form" onSubmit={event => { event.preventDefault(); if (cancelReason.trim().length >= 3) onStatus(order, "cancelled", cancelReason.trim()); }}><label>Motif d’annulation<textarea required minLength={3} maxLength={250} value={cancelReason} disabled={busy} onChange={event => setCancelReason(event.target.value)} placeholder="Expliquez le motif au client et à l’équipe." /></label><p>L’annulation est définitive et informe tous les espaces concernés.</p><div><button type="button" className="staff-button" onClick={() => setCancelOpen(false)} disabled={busy}>Garder la commande</button><button type="submit" className="staff-button menu-danger" disabled={busy || cancelReason.trim().length < 3}>Confirmer l’annulation</button></div></form>}
    <div className="staff-delivery-strip"><Bike size={16} /><span>{order.courierName ? <>Livreur : <strong>{order.courierName}</strong></> : order.status === "pending" ? "La recherche de livreur commence après acceptation." : order.status === "delivered" || order.status === "cancelled" ? "Suivi de livraison archivé" : "Aucun livreur assigné pour le moment"}</span>{order.courierName && <small>{order.status === "picked_up" ? "Commande récupérée" : order.status === "delivered" ? "Livraison terminée" : order.status === "cancelled" ? "Mission annulée" : "Retrait à venir"}</small>}</div>
    {canAssign && <details className="staff-order-details staff-dispatch"><summary>{order.courierId ? "Réassigner ou libérer la course" : "Assigner un livreur"}<ChevronDown size={16} /></summary><form className="staff-action-form" onSubmit={event => { event.preventDefault(); if (assignReason.trim().length >= 3) onAssign(order, courierId || null, assignReason.trim()); }}><label>Livreur<select value={courierId} disabled={busy} onChange={event => setCourierId(event.target.value)}><option value="">Aucun livreur — rendre la course disponible</option>{couriers.map(courier => <option key={courier.id} value={courier.id} disabled={courier.id !== order.courierId && (!courier.online || !!courier.activeOrderId && courier.activeOrderId !== order.id)}>{courier.name} · {courier.activeOrderId && courier.activeOrderId !== order.id ? "En mission" : courier.online ? "En ligne" : "En pause"}</option>)}</select></label><label>Motif de l’affectation<textarea required minLength={3} maxLength={250} value={assignReason} disabled={busy} onChange={event => setAssignReason(event.target.value)} placeholder="Indiquez pourquoi vous changez l’affectation." /></label><p>Une seule mission active par livreur. L’affectation est verrouillée après le retrait.</p><button type="submit" className="staff-button" disabled={busy || assignReason.trim().length < 3 || courierId === (order.courierId ?? "")}>{busy ? "Enregistrement…" : courierId ? "Confirmer l’affectation" : "Libérer la course"}</button></form></details>}
    <details className="staff-order-details">
      <summary>Livraison et suivi<ChevronDown size={16} /></summary>
      <div className="staff-order-detail-grid">
        <div><h4>Retrait au restaurant</h4><p>{order.pickupAddress}<br />{order.pickupCity}</p><h4>Coordonnées de livraison</h4><p>{order.address}<br />{order.city}</p>{order.details && <p className="staff-muted">{order.details}</p>}<a href={`tel:${order.phone.replace(/[^+\d]/g, "")}`}><Phone size={14} />{order.phone}</a></div>
        <div><h4>Historique de la commande</h4><ol className="staff-timeline">{order.history.map((event, index) => <li key={`${event.status}-${index}`}><span className="staff-timeline-dot" /><span>{event.label || statusLabels[event.status]}{event.actorName && <small className="staff-event-actor">{event.actorName}</small>}</span><time dateTime={event.date}>{dateLabel(event.date)}</time></li>)}</ol></div>
      </div>
    </details>
  </article>;
}

export default function Staff(props: { user: User; onLogout: () => void; onShop: () => void }) {
  return props.user.role === "courier" ? <Courier key={props.user.id} {...props} /> : <StaffDashboard key={props.user.id} {...props} />;
}

function StaffDashboard({ user, onLogout, onShop }: { user: User; onLogout: () => void; onShop: () => void }) {
  const admin = user.role === "admin";
  const [tab, setTab] = useState<StaffTab>("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [couriers, setCouriers] = useState<CourierProfile[]>([]);
  const [menuRestaurantId, setMenuRestaurantId] = useState(user.restaurantId || "");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updated, setUpdated] = useState("");
  const [busyKeys, setBusyKeys] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("active");
  const [restaurantFilter, setRestaurantFilter] = useState("all");
  const [search, setSearch] = useState("");
  const requestSequence = useRef(0);
  const mutations = useRef(new Set<string>());
  const mounted = useRef(true);

  const refresh = useCallback(async (silent = false) => {
    if (mutations.current.size) return;
    const sequence = ++requestSequence.current;
    if (!silent) setRefreshing(true);
    try {
      const [orderData, restaurantData, userData, courierData] = await Promise.all([
        api<{ orders: Order[] }>("/api/orders"),
        api<{ restaurants: Restaurant[] }>("/api/restaurants"),
        admin ? api<{ users: User[] }>("/api/users") : Promise.resolve({ users: [] as User[] }),
        admin ? api<{ couriers: CourierProfile[] }>("/api/couriers") : Promise.resolve({ couriers: [] as CourierProfile[] }),
      ]);
      if (!mounted.current || sequence !== requestSequence.current) return;
      setOrders(orderData.orders);
      setRestaurants(restaurantData.restaurants);
      setUsers(userData.users);
      setCouriers(courierData.couriers);
      setUpdated(new Date().toISOString());
      setError("");
    } catch (cause) {
      if (mounted.current && sequence === requestSequence.current) setError(cause instanceof Error ? cause.message : "Le chargement a échoué. Réessayez.");
    } finally {
      if (mounted.current && sequence === requestSequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [admin]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 8000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { mounted.current = false; ++requestSequence.current; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4500); return () => window.clearTimeout(timer); }, [notice]);

  async function mutate(key: string, action: () => Promise<void>, message: string) {
    if (mutations.current.has(key)) return;
    mutations.current.add(key);
    ++requestSequence.current;
    setRefreshing(false);
    setBusyKeys([...mutations.current]);
    setError("");
    try { await action(); if (mounted.current) { setNotice(message); setUpdated(new Date().toISOString()); } }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "La modification n’a pas été enregistrée."); }
    finally { mutations.current.delete(key); if (mounted.current) setBusyKeys([...mutations.current]); }
  }

  function changeStatus(order: Order, status: OrderStatus, reason?: string) {
    void mutate(`order-${order.id}`, async () => {
      const data = await api<{ order: Order }>(`/api/orders/${encodeURIComponent(order.id)}`, { method: "PATCH", body: JSON.stringify({ status, ...(reason ? { reason } : {}) }) });
      if (mounted.current) setOrders(current => current.map(item => item.id === order.id ? data.order : item));
    }, `${order.id} · ${statusLabels[status]}`);
  }

  function toggleRestaurant(restaurant: Restaurant) {
    const acceptingOrders = !restaurant.acceptingOrders;
    void mutate(`restaurant-${restaurant.id}`, async () => {
      const data = await api<{ restaurant: Restaurant }>(`/api/restaurants/${encodeURIComponent(restaurant.id)}`, { method: "PATCH", body: JSON.stringify({ acceptingOrders }) });
      if (mounted.current) setRestaurants(current => current.map(item => item.id === restaurant.id ? data.restaurant : item));
    }, `${restaurant.name} ${acceptingOrders ? "accepte les commandes." : "est en pause."}`);
  }

  function assignCourier(order: Order, courierId: string | null, reason: string) {
    void mutate(`order-${order.id}`, async () => {
      const data = await api<{ order: Order }>(`/api/orders/${encodeURIComponent(order.id)}/assign`, { method: "POST", body: JSON.stringify({ courierId, reason }) });
      if (mounted.current) setOrders(current => current.map(item => item.id === order.id ? data.order : item));
      const refreshed = await api<{ couriers: CourierProfile[] }>("/api/couriers");
      if (mounted.current) setCouriers(refreshed.couriers);
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
      <button type="button" className="staff-brand" onClick={onShop} aria-label="Manjéo, voir la vitrine">manjéo<span>•</span></button>
      <span className="staff-space-label">{admin ? <ShieldCheck size={17} /> : <ChefHat size={18} />}{admin ? "Administration" : "Espace restaurateur"}</span>
      <div className="staff-header-actions"><button type="button" className="staff-shop-link" onClick={onShop} aria-label="Voir la vitrine"><ArrowLeft size={15} /><span>Voir la vitrine</span></button><button type="button" className="staff-logout" onClick={onLogout} aria-label="Déconnexion"><LogOut size={16} /><span>Déconnexion</span></button></div>
    </div></header>

    <main className="staff-main">
      <section className="staff-welcome">
        <div><p className="staff-eyebrow">{admin ? "MANJÉO · VUE D’ENSEMBLE" : "VOTRE CUISINE, EN DIRECT"}</p><h1>{admin ? "Tout se passe ici." : ownRestaurant?.name ?? "Votre restaurant"}</h1><p>{admin ? "Coordonnez clients, cuisines et livreurs sur un même parcours." : "Une nouvelle commande ? À vous de jouer."}</p></div>
        <div className="staff-user-card"><span className="staff-avatar">{admin ? <ShieldCheck size={22} /> : <ChefHat size={24} />}</span><div><strong>{user.name}</strong><span>{roleLabels[user.role]} · compte démo</span></div></div>
      </section>

      {!admin && ownRestaurant && <section className={`staff-service ${ownRestaurant.acceptingOrders ? "staff-service-open" : "staff-service-paused"}`} aria-label="Réception des commandes"><div><span className="staff-service-dot" /><div><strong>{ownRestaurant.acceptingOrders ? "Vous recevez les commandes" : "La réception des commandes est en pause"}</strong><p>{ownRestaurant.acceptingOrders ? "Votre carte est ouverte dans la vitrine client." : "Les commandes déjà reçues restent à traiter."}</p></div></div><button type="button" role="switch" aria-checked={ownRestaurant.acceptingOrders} aria-label="Accepter de nouvelles commandes" disabled={busyKeys.includes(`restaurant-${ownRestaurant.id}`)} className="staff-switch" onClick={() => toggleRestaurant(ownRestaurant)}><span /></button></section>}

      <section className="staff-stats" aria-label="Indicateurs de la démonstration">
        <div className="staff-stat"><span className="staff-stat-icon staff-stat-orange"><Clock3 size={21} /></span><div><span>À accepter</span><strong>{loading ? "—" : pendingCount}</strong></div>{pendingCount > 0 && <span className="staff-stat-label">À vous de jouer</span>}</div>
        <div className="staff-stat"><span className="staff-stat-icon"><ShoppingBag size={21} /></span><div><span>En cours</span><strong>{loading ? "—" : activeOrders.length}</strong></div><small>De la réception à la livraison</small></div>
        <div className="staff-stat"><span className="staff-stat-icon staff-stat-green"><CreditCard size={21} /></span><div><span>{admin ? "Total livré simulé" : "Ventes livrées simulées"}</span><strong>{loading ? "—" : money(totalSales)}</strong></div><small>{delivered.length} commande{delivered.length > 1 ? "s" : ""}{!admin && " · hors livraison"}</small></div>
      </section>

      <div className="staff-navigation"><nav aria-label="Gestion"><div className="staff-tabs">{tabs.map(item => <button type="button" key={item.id} className={tab === item.id ? "staff-tab staff-tab-active" : "staff-tab"} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}><item.icon size={17} />{item.label}{item.id === "orders" && pendingCount > 0 && <span>{pendingCount}</span>}</button>)}</div></nav><button type="button" className="staff-refresh" onClick={() => void refresh()} disabled={refreshing || busyKeys.length > 0} aria-label="Actualiser les données"><RefreshCw size={15} className={refreshing ? "staff-spinning" : ""} /><span>{refreshing ? "Actualisation…" : "Actualiser"}</span></button></div>

      {error && <div className="staff-alert" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>Réessayer</button></div>}
      {loading ? <div className="staff-loading" role="status"><RefreshCw size={23} className="staff-spinning" /><p>Ouverture de votre espace…</p></div> : <>
        {tab === "orders" && <section aria-label="Liste des commandes">
          <div className="staff-section-heading"><div><h2>Les commandes</h2><p>{admin ? "Un suivi partagé pour tous les restaurants." : "Acceptez, préparez, puis signalez que tout est prêt."}</p></div><span className="staff-result-count">{visibleOrders.length} résultat{visibleOrders.length > 1 ? "s" : ""}</span></div>
          <div className="staff-filters"><label className="staff-search"><Search size={17} /><input aria-label="Rechercher une commande" placeholder="Nom, numéro, ville…" value={search} onChange={event => setSearch(event.target.value)} /></label><label className="staff-select"><span>Statut</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="active">En cours</option><option value="all">Toutes les commandes</option>{allStatuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select><ChevronDown size={14} /></label>{admin && <label className="staff-select"><span>Restaurant</span><select value={restaurantFilter} onChange={event => setRestaurantFilter(event.target.value)}><option value="all">Tous les restaurants</option>{restaurants.map(restaurant => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>)}</select><ChevronDown size={14} /></label>}</div>
          {visibleOrders.length ? <div className="staff-orders">{visibleOrders.map(order => <OrderCard key={order.id} order={order} admin={admin} busy={busyKeys.includes(`order-${order.id}`)} onStatus={changeStatus} couriers={couriers} onAssign={assignCourier} />)}</div> : <div className="staff-empty"><span><PackageCheck size={32} /></span><h3>{orders.length ? "Aucune commande avec ces filtres" : "La première commande se prépare ici"}</h3><p>{orders.length ? "Essayez un autre statut ou effacez votre recherche." : "Connectez-vous avec le compte client pour passer une commande test. Elle apparaîtra ici automatiquement."}</p>{orders.length > 0 ? <button type="button" className="staff-button" onClick={() => { setSearch(""); setStatusFilter("all"); setRestaurantFilter("all"); }}>Voir toutes les commandes</button> : <span className="staff-empty-account">client@manjeo.test</span>}</div>}
        </section>}

        {menuRestaurant && <section hidden={tab !== "menu"} aria-label="Gestion des cartes">{admin && <label className="staff-menu-selector">Restaurant à modifier<select value={menuRestaurant.id} onChange={event => setMenuRestaurantId(event.target.value)}>{restaurants.map(restaurant => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>)}</select></label>}<MenuEditor key={menuRestaurant.id} restaurant={menuRestaurant} onRestaurantChange={restaurant => { ++requestSequence.current; setRefreshing(false); setRestaurants(current => current.map(item => item.id === restaurant.id ? restaurant : item)); }} /></section>}

        {tab === "couriers" && admin && <section aria-label="Activité des livreurs"><div className="staff-section-heading"><div><h2>Les livreurs, en direct</h2><p>{couriers.filter(courier => courier.online && !courier.activeOrderId).length} disponible(s) · une mission active par livreur.</p></div></div><div className="staff-couriers">{couriers.map(courier => { const mission = orders.find(order => order.id === courier.activeOrderId); return <article className="staff-courier" key={courier.id}><span className="staff-avatar"><Bike size={25} /></span><div><h3>{courier.name}</h3><p>{courier.email}</p><span className={`staff-status ${courier.activeOrderId ? "staff-status-picked_up" : courier.online ? "staff-status-ready" : "staff-status-pending"}`}><span />{courier.activeOrderId ? "En mission" : courier.online ? "Disponible" : "En pause"}</span>{mission ? <p className="staff-courier-mission">{mission.restaurant} → {mission.city}<br /><strong>{statusLabels[mission.status]}</strong></p> : <p className="staff-courier-mission">{courier.online ? "Peut prendre une nouvelle course" : "Les nouvelles attributions sont en pause"}</p>}{courier.activeOrderId && <button type="button" className="staff-button" onClick={() => { setSearch(courier.activeOrderId || ""); setStatusFilter("all"); setRestaurantFilter("all"); setTab("orders"); }}>Voir la mission<ArrowRight size={14} /></button>}</div></article>; })}</div>{!couriers.length && <div className="staff-empty"><span><Bike size={29} /></span><h3>Aucun livreur pour le moment</h3><p>Les comptes livreur apparaissent ici avec leur disponibilité.</p></div>}<p className="staff-help"><Bike size={17} />Depuis une commande acceptée, attribuez ou réattribuez une course à un livreur disponible. Après le retrait, seul ce livreur peut confirmer la livraison avec le code client.</p></section>}

        {tab === "restaurants" && <section aria-label="Gestion des restaurants"><div className="staff-section-heading"><div><h2>Les restaurants partenaires</h2><p>{restaurants.filter(restaurant => restaurant.acceptingOrders).length} restaurants ouverts aux commandes test.</p></div><span className="staff-result-count">{restaurants.length} restaurants fictifs</span></div><div className="staff-restaurants">{restaurants.map(restaurant => <article className="staff-restaurant" key={restaurant.id}><img src={restaurant.image} alt="" /><div className="staff-restaurant-info"><span className="staff-category">{restaurant.category}</span><h3>{restaurant.name}</h3><p>{restaurant.products.filter(product => product.available).length} produits disponibles · {restaurant.minutes} min</p><button type="button" className="staff-button staff-edit-menu" onClick={() => { setMenuRestaurantId(restaurant.id); setTab("menu"); }}><UtensilsCrossed size={14} />Gérer la carte</button><div className="staff-restaurant-toggle"><span className={restaurant.acceptingOrders ? "staff-open-label" : "staff-paused-label"}>{restaurant.acceptingOrders ? "Ouvert aux commandes" : "Commandes en pause"}</span><button type="button" role="switch" aria-checked={restaurant.acceptingOrders} aria-label={`${restaurant.name} : accepter les commandes`} className="staff-switch" disabled={busyKeys.includes(`restaurant-${restaurant.id}`)} onClick={() => toggleRestaurant(restaurant)}><span /></button></div></div></article>)}</div><p className="staff-help"><Store size={16} />Mettre un restaurant en pause bloque les nouvelles commandes. Les commandes reçues restent accessibles.</p></section>}

        {tab === "users" && <section aria-label="Comptes de démonstration"><div className="staff-section-heading"><div><h2>Un compte pour chaque rôle</h2><p>Quatre espaces reliés, du choix du repas à sa remise.</p></div><span className="staff-result-count">{users.length} comptes</span></div><div className="staff-role-summary">{(["client", "restaurant", "courier", "admin"] as const).map(role => <span key={role}>{roleLabels[role]}<strong>{users.filter(account => account.role === role).length}</strong></span>)}</div><div className="staff-accounts">{users.map(account => <article className="staff-account" key={account.id}><span className={`staff-account-icon staff-account-${account.role}`}>{account.role === "admin" ? <ShieldCheck size={23} /> : account.role === "restaurant" ? <ChefHat size={24} /> : account.role === "courier" ? <Bike size={24} /> : <ShoppingBag size={23} />}</span><div><span className="staff-account-role">{roleLabels[account.role]}</span><h3>{account.name}</h3><p>{account.email}</p><small>{account.role === "restaurant" ? restaurants.find(restaurant => restaurant.id === account.restaurantId)?.name ?? "Restaurant associé" : account.role === "admin" ? "Accès à tous les restaurants et commandes" : account.role === "courier" ? "Courses, retrait et confirmation de remise" : "Commande et suivi de ses commandes"}</small></div>{account.id === user.id && <span className="staff-you">Vous</span>}</article>)}</div><div className="staff-account-tip"><Users size={21} /><div><strong>Testez le parcours de bout en bout</strong><p>Déconnectez-vous pour changer de rôle : commandez côté client, préparez côté restaurant, récupérez et livrez côté livreur avec le code affiché au client. L’admin supervise l’ensemble.</p></div></div></section>}
      </>}

      <footer className="staff-footer"><span><span className="staff-live-dot" />{updated ? `Actualisé à ${timeLabel(updated)} · toutes les 8 s` : "Données partagées"}</span><p>Démo en ligne · aucun paiement ni livraison réelle</p></footer>
    </main>
    {notice && <div className="staff-toast" role="status"><CheckCircle2 size={18} />{notice}</div>}
  </div>;
}
