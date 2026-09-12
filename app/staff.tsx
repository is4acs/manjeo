import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChefHat, ChevronDown, Clock3, ClipboardList, CreditCard, LogOut, MapPin, PackageCheck, Phone, RefreshCw, Search, ShieldCheck, ShoppingBag, Store, Users, UtensilsCrossed, X } from "lucide-react";
import { api, type User, type Order, type OrderStatus, statusLabels } from "@/lib/api";
import { money, type Restaurant } from "@/lib/menu";
import "./staff.css";

type StaffTab = "orders" | "menu" | "restaurants" | "users";
const activeStatuses: OrderStatus[] = ["pending", "accepted", "preparing", "ready"];
const allStatuses: OrderStatus[] = [...activeStatuses, "delivered", "cancelled"];
const nextActions: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  pending: { status: "accepted", label: "Accepter la commande" },
  accepted: { status: "preparing", label: "Commencer la préparation" },
  preparing: { status: "ready", label: "Marquer prête" },
  ready: { status: "delivered", label: "Simuler la livraison" },
};
const roleLabels = { client: "Client", restaurant: "Restaurateur", admin: "Administrateur" };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const dateLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "America/Cayenne", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const timeLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "America/Cayenne", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`staff-status staff-status-${status}`}><span />{statusLabels[status]}</span>;
}

function OrderCard({ order, admin, busy, onStatus }: { order: Order; admin: boolean; busy: boolean; onStatus: (order: Order, status: OrderStatus) => void }) {
  const next = nextActions[order.status];
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
        {(order.status === "pending" || order.status === "accepted") && <button type="button" className="staff-cancel" disabled={busy} onClick={() => onStatus(order, "cancelled")}><X size={14} />Annuler la commande</button>}
        {order.status === "delivered" && <p className="staff-order-complete"><CheckCircle2 size={17} />Parcours test terminé</p>}
      </div>
    </div>
    <details className="staff-order-details">
      <summary>Livraison et suivi<ChevronDown size={16} /></summary>
      <div className="staff-order-detail-grid">
        <div><h4>Coordonnées de livraison</h4><p>{order.address}<br />{order.city}</p>{order.details && <p className="staff-muted">{order.details}</p>}<a href={`tel:${order.phone.replace(/[^+\d]/g, "")}`}><Phone size={14} />{order.phone}</a></div>
        <div><h4>Historique de la commande</h4><ol className="staff-timeline">{order.history.map((event, index) => <li key={`${event.status}-${index}`}><span className="staff-timeline-dot" /><span>{statusLabels[event.status]}</span><time dateTime={event.date}>{dateLabel(event.date)}</time></li>)}</ol></div>
      </div>
    </details>
  </article>;
}

export default function Staff({ user, onLogout, onShop }: { user: User; onLogout: () => void; onShop: () => void }) {
  const admin = user.role === "admin";
  const [tab, setTab] = useState<StaffTab>("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
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
      const [orderData, restaurantData, userData] = await Promise.all([
        api<{ orders: Order[] }>("/api/orders"),
        api<{ restaurants: Restaurant[] }>("/api/restaurants"),
        admin ? api<{ users: User[] }>("/api/users") : Promise.resolve({ users: [] as User[] }),
      ]);
      if (!mounted.current || sequence !== requestSequence.current) return;
      setOrders(orderData.orders);
      setRestaurants(restaurantData.restaurants);
      setUsers(userData.users);
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

  function changeStatus(order: Order, status: OrderStatus) {
    void mutate(`order-${order.id}`, async () => {
      const data = await api<{ order: Order }>(`/api/orders/${encodeURIComponent(order.id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
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

  function toggleProduct(restaurant: Restaurant, productId: string, available: boolean) {
    void mutate(`product-${productId}`, async () => {
      await api(`/api/restaurants/${encodeURIComponent(restaurant.id)}/products/${encodeURIComponent(productId)}`, { method: "PATCH", body: JSON.stringify({ available }) });
      if (mounted.current) setRestaurants(current => current.map(item => item.id === restaurant.id ? { ...item, products: item.products.map(product => product.id === productId ? { ...product, available } : product) } : item));
    }, available ? "Le produit est de nouveau disponible." : "Le produit est indiqué indisponible dans la vitrine.");
  }

  const ownRestaurant = restaurants.find(item => item.id === user.restaurantId);
  const activeOrders = orders.filter(order => activeStatuses.includes(order.status));
  const pendingCount = orders.filter(order => order.status === "pending").length;
  const delivered = orders.filter(order => order.status === "delivered");
  const totalSales = delivered.reduce((sum, order) => sum + (admin ? order.total : order.subtotal), 0);
  const visibleOrders = useMemo(() => orders.filter(order => {
    const statusMatch = statusFilter === "all" || (statusFilter === "active" ? activeStatuses.includes(order.status) : order.status === statusFilter);
    return statusMatch && (restaurantFilter === "all" || order.restaurantId === restaurantFilter) && normalize(`${order.id} ${order.customerName} ${order.restaurant} ${order.city}`).includes(normalize(search.trim()));
  }).sort((a, b) => b.date.localeCompare(a.date)), [orders, statusFilter, restaurantFilter, search]);
  const tabs: { id: StaffTab; label: string; icon: typeof ClipboardList }[] = admin
    ? [{ id: "orders", label: "Commandes", icon: ClipboardList }, { id: "restaurants", label: "Restaurants", icon: Store }, { id: "users", label: "Comptes", icon: Users }]
    : [{ id: "orders", label: "Commandes", icon: ClipboardList }, { id: "menu", label: "Ma carte", icon: UtensilsCrossed }];

  return <div className="staff-app">
    <header className="staff-header"><div className="staff-header-inner">
      <button type="button" className="staff-brand" onClick={onShop} aria-label="Manjéo, voir la vitrine">manjéo<span>•</span></button>
      <span className="staff-space-label">{admin ? <ShieldCheck size={17} /> : <ChefHat size={18} />}{admin ? "Administration" : "Espace restaurateur"}</span>
      <div className="staff-header-actions"><button type="button" className="staff-shop-link" onClick={onShop} aria-label="Voir la vitrine"><ArrowLeft size={15} /><span>Voir la vitrine</span></button><button type="button" className="staff-logout" onClick={onLogout} aria-label="Déconnexion"><LogOut size={16} /><span>Déconnexion</span></button></div>
    </div></header>

    <main className="staff-main">
      <section className="staff-welcome">
        <div><p className="staff-eyebrow">{admin ? "MANJÉO · VUE D’ENSEMBLE" : "VOTRE CUISINE, EN DIRECT"}</p><h1>{admin ? "Tout se passe ici." : ownRestaurant?.name ?? "Votre restaurant"}</h1><p>{admin ? "Suivez les commandes et pilotez les restaurants de la démo." : "Une nouvelle commande ? À vous de jouer."}</p></div>
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
          {visibleOrders.length ? <div className="staff-orders">{visibleOrders.map(order => <OrderCard key={order.id} order={order} admin={admin} busy={busyKeys.includes(`order-${order.id}`)} onStatus={changeStatus} />)}</div> : <div className="staff-empty"><span><PackageCheck size={32} /></span><h3>{orders.length ? "Aucune commande avec ces filtres" : "La première commande se prépare ici"}</h3><p>{orders.length ? "Essayez un autre statut ou effacez votre recherche." : "Connectez-vous avec le compte client pour passer une commande test. Elle apparaîtra ici automatiquement."}</p>{orders.length > 0 ? <button type="button" className="staff-button" onClick={() => { setSearch(""); setStatusFilter("all"); setRestaurantFilter("all"); }}>Voir toutes les commandes</button> : <span className="staff-empty-account">client@manjeo.test</span>}</div>}
        </section>}

        {tab === "menu" && ownRestaurant && <section aria-label="Disponibilité de la carte"><div className="staff-section-heading"><div><h2>Votre carte, à jour</h2><p>Un produit épuisé ? Mettez-le en pause en un clic.</p></div><span className="staff-result-count">{ownRestaurant.products.filter(product => product.available).length}/{ownRestaurant.products.length} disponibles</span></div>{[...new Set(ownRestaurant.products.map(product => product.group))].map(group => <div className="staff-menu-group" key={group}><h3>{group}</h3><div className="staff-menu-grid">{ownRestaurant.products.filter(product => product.group === group).map(product => <article className={`staff-product ${!product.available ? "staff-product-unavailable" : ""}`} key={product.id}>{product.image ? <img src={product.image} alt="" /> : <div className="staff-product-placeholder"><UtensilsCrossed size={28} /></div>}<div className="staff-product-info"><h4>{product.name}</h4><p>{product.description}</p><div><strong>{money(product.price)}</strong><button type="button" className={`staff-availability ${product.available ? "staff-available" : ""}`} aria-pressed={product.available} aria-label={`${product.name} : ${product.available ? "disponible, rendre indisponible" : "indisponible, rendre disponible"}`} disabled={busyKeys.includes(`product-${product.id}`)} onClick={() => toggleProduct(ownRestaurant, product.id, !product.available)}>{product.available ? <Check size={14} /> : <X size={14} />}{product.available ? "Disponible" : "Indisponible"}</button></div></div></article>)}</div></div>)}<p className="staff-help"><CheckCircle2 size={16} />Les disponibilités sont enregistrées et partagées avec la vitrine client.</p></section>}

        {tab === "restaurants" && <section aria-label="Gestion des restaurants"><div className="staff-section-heading"><div><h2>Les restaurants partenaires</h2><p>{restaurants.filter(restaurant => restaurant.acceptingOrders).length} restaurants ouverts aux commandes test.</p></div><span className="staff-result-count">{restaurants.length} restaurants fictifs</span></div><div className="staff-restaurants">{restaurants.map(restaurant => <article className="staff-restaurant" key={restaurant.id}><img src={restaurant.image} alt="" /><div className="staff-restaurant-info"><span className="staff-category">{restaurant.category}</span><h3>{restaurant.name}</h3><p>{restaurant.products.filter(product => product.available).length} produits disponibles · {restaurant.minutes} min</p><div className="staff-restaurant-toggle"><span className={restaurant.acceptingOrders ? "staff-open-label" : "staff-paused-label"}>{restaurant.acceptingOrders ? "Ouvert aux commandes" : "Commandes en pause"}</span><button type="button" role="switch" aria-checked={restaurant.acceptingOrders} aria-label={`${restaurant.name} : accepter les commandes`} className="staff-switch" disabled={busyKeys.includes(`restaurant-${restaurant.id}`)} onClick={() => toggleRestaurant(restaurant)}><span /></button></div></div></article>)}</div><p className="staff-help"><Store size={16} />Mettre un restaurant en pause bloque les nouvelles commandes. Les commandes reçues restent accessibles.</p></section>}

        {tab === "users" && <section aria-label="Comptes de démonstration"><div className="staff-section-heading"><div><h2>Un compte pour chaque rôle</h2><p>Trois regards sur le même parcours de commande.</p></div><span className="staff-result-count">{users.length} comptes</span></div><div className="staff-role-summary">{(["client", "restaurant", "admin"] as const).map(role => <span key={role}>{roleLabels[role]}<strong>{users.filter(account => account.role === role).length}</strong></span>)}</div><div className="staff-accounts">{users.map(account => <article className="staff-account" key={account.id}><span className={`staff-account-icon staff-account-${account.role}`}>{account.role === "admin" ? <ShieldCheck size={23} /> : account.role === "restaurant" ? <ChefHat size={24} /> : <ShoppingBag size={23} />}</span><div><span className="staff-account-role">{roleLabels[account.role]}</span><h3>{account.name}</h3><p>{account.email}</p><small>{account.role === "restaurant" ? restaurants.find(restaurant => restaurant.id === account.restaurantId)?.name ?? "Restaurant associé" : account.role === "admin" ? "Accès à tous les restaurants et commandes" : "Commande et suivi de ses commandes"}</small></div>{account.id === user.id && <span className="staff-you">Vous</span>}</article>)}</div><div className="staff-account-tip"><Users size={21} /><div><strong>Testez le parcours de bout en bout</strong><p>Déconnectez-vous pour changer de rôle : commandez côté client, préparez côté restaurant, puis consultez le suivi dans cet espace.</p></div></div></section>}
      </>}

      <footer className="staff-footer"><span><span className="staff-live-dot" />{updated ? `Actualisé à ${timeLabel(updated)} · toutes les 8 s` : "Données locales"}</span><p>Démo locale · aucun paiement ni livraison réelle</p></footer>
    </main>
    {notice && <div className="staff-toast" role="status"><CheckCircle2 size={18} />{notice}</div>}
  </div>;
}
