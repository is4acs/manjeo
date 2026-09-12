"use client";
import { t, localeTag, tEvent, formatDate, getLanguage } from "@/lib/i18n";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bike, Check, CheckCheck, ChevronLeft, Clock3, MapPin, Minus, PackageCheck, Plus, Search, ShoppingBag, Tag, Utensils, UserRound, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { categories, money, type Restaurant, type Product, type Selection } from "@/lib/menu";
import { defaultSelections, selectionsValid, selectionPrice, makeLine, lineNeedsUpdate, validStoredLine, type CartLine as Line } from "@/lib/cart";
import "./customer-flow.css";
import OrderTracking from "./order-tracking";
import AddressField from "./address-field";
import AddressVerification, { savedAddressMatches } from "./address-verification";
import PaymentMethods from "./payment-methods";
import OrderChat from "./order-chat";
import SiteFooter from "./site-footer";
import { prepareOrderRequest, restoreOrderRequest, type OrderRequest } from "@/lib/checkout-request";
import { readPendingOrder, writePendingOrder, clearPendingOrder, orderMatchesCart } from './checkout-state';
import { promotionContext, quotedDiscount, shouldAdoptProfileLocation, hasOrderConversation, type ProfileLocation } from "./customer-state";

import { api, ApiError, statusLabels, type Order, type Promotion, type PublicPromotion, type User, type Role, type AddressCandidate, type PaymentMethod, type PaymentConfig } from "@/lib/api";

type View = "home" | "restaurant" | "checkout" | "success";
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const cities = ["Cayenne", "Rémire-Montjoly", "Matoury"];
const sorts = [{id: "recommended", label: "Recommandés"}, {id: "fast", label: "Le plus rapide"}, {id: "price", label: "Prix croissant"}];
const pageSize = 4;
// Les transitions restent fonctionnelles : aucun défilement animé quand le visiteur le refuse.
const scrollToBlock = (element: HTMLElement | null) => element?.scrollIntoView({behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start"});

export default function Home({user, restaurants, refreshCatalog, onAccount, onStaff, onSaveProfile, languageControl}: {languageControl?: React.ReactNode; onSaveProfile: (payload: Record<string, unknown>) => Promise<User>; user: User | null; restaurants: Restaurant[]; refreshCatalog: () => Promise<Restaurant[]>; onAccount: (role?: Role) => void; onStaff: () => void}) {
  const locale = localeTag();
  const [view, setView] = useState<View>("home");
  const [selectedId, setSelectedId] = useState("ti-kreol");
  const [category, setCategory] = useState("Tout");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recommended");
  const [cart, setCart] = useState<Line[]>([]);
  const [ready, setReady] = useState(false);
  const [city, setCity] = useState("Cayenne");
  const [address, setAddress] = useState("");
  const [checkoutName, setCheckoutName] = useState(user?.name || "");
  const [checkoutPhone, setCheckoutPhone] = useState(user?.phone || "");
  const [details, setDetails] = useState('');
  const [notes, setNotes] = useState('');
  const [addressCandidate, setAddressCandidate] = useState<AddressCandidate | null>(null);
  const [saveForNext, setSaveForNext] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(user?.paymentMethod || 'demo');
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const paymentOpening = useRef(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [profileSaveWarning, setProfileSaveWarning] = useState<string | null>(null);
  const paymentReturn = useRef('');
  const contactTouched = useRef({name: false, phone: false});
  const [locationOpen, setLocationOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState<Line | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | {source: string; params: Record<string, string | number>}>("");
  const [orderError, setOrderError] = useState("");
  const [ordersError, setOrdersError] = useState("");
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [updatingCart, setUpdatingCart] = useState(false);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [visible, setVisible] = useState(pageSize);
  const [promoCode, setPromoCode] = useState("");
  const [quote, setQuote] = useState<{context: string; promotion: Promotion} | null>(null);
  const [appliedCode, setAppliedCode] = useState("");
  const [promoError, setPromoError] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const [offers, setOffers] = useState<PublicPromotion[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [activeGroup, setActiveGroup] = useState("");
  const listRef = useRef<HTMLElement>(null);
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});
  const request = useRef<OrderRequest<Record<string, unknown>> | null>(null);
  const [pendingRequest, setPendingRequest] = useState<OrderRequest<Record<string, unknown>> | null>(null);
  const activeUser = useRef(user?.id);
  const accountSession = useRef({id: user?.id, generation: 0});
  if (accountSession.current.id !== user?.id) accountSession.current = {id: user?.id, generation: accountSession.current.generation + 1};
  const addressAccount = useRef(user?.id);
  const profileLocation = useRef<ProfileLocation | null>(null);
  const profilePayment = useRef({id: user?.id, method: user?.paymentMethod || 'demo'});
  const orderSequence = useRef(0);
  const promoSequence = useRef(0);
  const submittingRef = useRef(false);
  const cancellingRef = useRef(false);
  const promoIdentity = useRef({context: "", code: ""});
  activeUser.current = user?.id;
  useEffect(() => () => { activeUser.current = undefined; accountSession.current = {id: undefined, generation: accountSession.current.generation + 1}; ++orderSequence.current; ++promoSequence.current; }, []);
  useEffect(() => {
    const markRead = (event: Event) => {
      const detail = (event as CustomEvent<{orderId: string; viewerId: string}>).detail;
      if (detail?.viewerId === activeUser.current && typeof detail.orderId === "string") setUnread(current => ({...current, [detail.orderId]: 0}));
    };
    window.addEventListener("manjeo-thread-read", markRead);
    return () => window.removeEventListener("manjeo-thread-read", markRead);
  }, []);
  const loadOrders = useCallback(async () => {
    if (user?.role !== "client" || submittingRef.current || cancellingRef.current) return;
    const userId = user.id;
    const sequence = ++orderSequence.current;
    setOrdersLoading(true);
    try {
      const data = await api<{orders: Order[]; unread: Record<string, number>}>("/api/orders", {accountId:userId});
      if (activeUser.current !== userId || sequence !== orderSequence.current) return;
      setOrders(data.orders); setUnread(data.unread || {}); setOrdersError("");
      const url = new URL(window.location.href);
      const returnedId = url.searchParams.get('order');
      const returned = data.orders.find(order => order.id === returnedId);
      if (url.searchParams.has('payment') && returned && paymentReturn.current !== `${userId}:${returnedId}`) {
        paymentReturn.current = `${userId}:${returnedId}`; setCurrentOrder(returned); setView('success');
        url.searchParams.delete('payment'); url.searchParams.delete('order'); window.history.replaceState(window.history.state, '', url);
      }
      setCurrentOrder(current => current ? data.orders.find(order => order.id === current.id) || current : null);
    } catch (error) { if (activeUser.current === userId && sequence === orderSequence.current) setOrdersError((error as Error).message); }
    finally { if (activeUser.current === userId && sequence === orderSequence.current) setOrdersLoading(false); }
  }, [user?.id, user?.role]);
  const restaurant = restaurants.find(r => r.id === selectedId) || restaurants[0];
  const cartRestaurant = restaurants.find(r => r.id === cart[0]?.restaurantId);
  const subtotal = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const delivery = cartRestaurant ? cartRestaurant.delivery + (city === "Cayenne" ? 0 : 100) : 0;
  const context = promotionContext({userId: user?.id, role: user?.role, restaurantId: cartRestaurant?.id, city, subtotal, delivery});
  promoIdentity.current = {context, code: appliedCode};
  const promotion = quote?.context === context && quote.promotion.code === appliedCode ? quote.promotion : null;
  const promoPending = !!appliedCode && (!promotion || promoBusy);
  const discount = quotedDiscount(quote, context, appliedCode, subtotal + delivery);
  const total = subtotal + delivery - discount;
  const savedDelivery = savedAddressMatches(user?.deliveryAddress, address, city);
  const confirmedCandidate = addressCandidate?.address === address.trim() && addressCandidate.city === city && Date.parse(addressCandidate.expiresAt) > Date.now() ? addressCandidate : null;
  const paymentReady = paymentMethod === 'demo' || !!paymentConfig?.stripeAvailable;
  const pendingOrder = useMemo(() => user?.role === 'client' ? restoreOrderRequest(pendingRequest, user.id) : null, [pendingRequest, user?.id, user?.role]);
  const quickReady = user?.role === 'client' && savedDelivery && user.name.trim().length >= 2 && /^\+?\d{10,15}$/.test((user.phone || '').replace(/[\s().-]/g, '')) && paymentReady;
  const activeOrders = orders.filter(order => !['delivered', 'cancelled'].includes(order.status));
  const cartUnavailable = !!cart.length && (!cartRestaurant?.acceptingOrders || cart.some(line => !cartRestaurant.products.find(item => item.id === line.productId)?.available));
  const cartOutdated = cart.some(line => lineNeedsUpdate(line, cartRestaurant?.products.find(item => item.id === line.productId)));
  const productCurrent = product && restaurant.products.find(item => item.id === product.id);
  const productOutdated = !!product && (!productCurrent || productCurrent.version !== product.version || !productCurrent.available || !restaurant.acceptingOrders);
  const groups = (restaurant?.categories || [...new Set(restaurant?.products.map(item => item.group) || [])]).filter(group => restaurant?.products.some(item => item.group === group));
  const heroRestaurant = restaurants[0];
  const heroProduct = heroRestaurant?.products.find(item => item.popular && item.available) || heroRestaurant?.products[0];
  const surcharge = city === "Cayenne" ? 0 : 100;
  // Les quatre promesses du bandeau se lisent dans le catalogue : rien n’y est annoncé que la démo ne tienne.
  const openNow = restaurants.filter(item => item.acceptingOrders).length;
  const promises = restaurants.length ? [
    ...offers.slice(0, 2).map(offer => t(offer.label)),
    t("Livraison dès {price}", {price: money(Math.min(...restaurants.map(item => item.delivery)) + surcharge)}),
    t(openNow > 1 ? "{count} tables ouvertes maintenant" : "{count} table ouverte maintenant", {count: openNow}),
    t("{min} à {max} min chrono", {min: Math.min(...restaurants.map(item => item.minutes)), max: Math.max(...restaurants.map(item => item.minutes + 10))}),
    t("Cuisiné à Cayenne"),
  ] : [];
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("manjeo-cart-v2") || "[]");
      if (Array.isArray(stored)) {
        const valid = stored.filter(validStoredLine).slice(0, 50);
        const source = valid.filter(line => line.restaurantId === valid[0]?.restaurantId);
        setCart(source.reduce<Line[]>((lines, line) => lines.reduce((sum, item) => sum + item.quantity, 0) + line.quantity <= 100 ? [...lines, line] : lines, []));
      }
      if (!localStorage.getItem("manjeo-cart-v2") && JSON.parse(localStorage.getItem("manjeo-cart-v1") || "[]").length) setNotice("La carte a évolué. Recomposez votre panier avec les nouvelles options.");
      const location = JSON.parse(localStorage.getItem("manjeo-location-v1") || "null");
      if (location && cities.includes(location.city)) {
        setCity(location.city);
        if (typeof location.address === "string") setAddress(location.address.slice(0, 180));
      }
    } catch { /* Reset damaged demo data. */ }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) { try { localStorage.setItem("manjeo-cart-v2", JSON.stringify(cart)); } catch {} } }, [cart, ready]);
  useEffect(() => { if (ready && !user) { try { localStorage.setItem("manjeo-location-v1", JSON.stringify({ city, address })); } catch {} } }, [city, address, ready, user?.id]);
  useEffect(() => {
    request.current = user?.role === 'client' ? readPendingOrder(sessionStorage, user.id) : null;
    setPendingRequest(request.current);
    if (addressAccount.current && addressAccount.current !== user?.id) {setAddress(user?.deliveryAddress?.address || ''); setCity(user?.deliveryAddress?.city || 'Cayenne');}
    addressAccount.current = user?.id;
    contactTouched.current = {name: false, phone: false}; setCheckoutName(user?.role === "client" ? user.name : ""); setCheckoutPhone(user?.role === "client" ? user.phone || "" : "");
    setAddressCandidate(null); setDetails(''); setNotes(''); setPaymentMethod(user?.paymentMethod || 'demo'); setPaymentError(''); setPaymentBusy(false); paymentOpening.current = false; setProfileSaveWarning(null);
    setOrders([]); setUnread({}); setCurrentOrder(null); setOrdersError(""); setOrderError(""); setOrdersLoading(false); setHistoryOpen(false); setSubmitting(false);
    ++orderSequence.current; ++promoSequence.current; setQuote(null); setAppliedCode(""); setPromoCode(""); setPromoBusy(false); setPromoError(""); setCancelOrder(null); setCancelError(""); setCancelling(false); submittingRef.current = false; cancellingRef.current = false;
    setView(current => current === "success" ? "home" : current);
  }, [user?.id]);
  useEffect(() => {
    if (user?.role !== "client") return;
    if (!contactTouched.current.name) setCheckoutName(user.name);
    if (!contactTouched.current.phone) setCheckoutPhone(user.phone || "");
  }, [user?.name, user?.phone, user?.role]);
  useEffect(() => {
    if (user?.role !== 'client') {profileLocation.current = null; return;}
    const previous = profileLocation.current;
    const next = {userId:user.id, address:user.deliveryAddress?.address || '', city:user.deliveryAddress?.city || 'Cayenne', details:user.deliveryAddress?.details || ''};
    profileLocation.current = next;
    if (shouldAdoptProfileLocation(previous, next, {address, city, details}, !!user.deliveryAddress)) {
      setAddress(next.address); setCity(next.city); setDetails(next.details); setAddressCandidate(null);
    }
  }, [user?.id, user?.deliveryAddress?.address, user?.deliveryAddress?.city, user?.deliveryAddress?.details, user?.deliveryAddress?.verifiedAt]);
  useEffect(() => {
    const next = {id: user?.id, method: user?.paymentMethod || 'demo'};
    if (profilePayment.current.id !== next.id || paymentMethod === profilePayment.current.method) setPaymentMethod(next.method);
    profilePayment.current = next;
  }, [user?.id, user?.paymentMethod]);
  useEffect(() => {
    let alive = true;
    void api<PaymentConfig>('/api/payments/config').then(config => {if (alive) setPaymentConfig(config);}).catch(() => {if (alive) setPaymentConfig({mode:'demo', stripeAvailable:false, reason:'Le paiement Stripe de test n’est pas configuré. La démonstration reste disponible.'});});
    return () => {alive = false;};
  }, []);
  useEffect(() => {
    if (user?.role !== "client") return;
    void loadOrders();
    const timer = window.setInterval(() => void loadOrders(), 8000);
    return () => window.clearInterval(timer);
  }, [loadOrders, user?.role]);
  useEffect(() => {
    const refresh = () => { void refreshCatalog().catch(() => {}); };
    const timer = window.setInterval(refresh, 8000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [refreshCatalog]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 3200); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [view, selectedId]);
  // Le bandeau annonce les codes réellement ouverts, jamais une promesse que la démo ne tient pas.
  useEffect(() => { void api<{promotions: PublicPromotion[]}>("/api/promotions").then(data => setOffers(data.promotions)).catch(() => {}); }, []);
  useEffect(() => { setVisible(pageSize); }, [category, search, sort]);
  useEffect(() => { setActiveGroup(""); groupRefs.current = {}; }, [selectedId]);
  const filtered = useMemo(() => restaurants.filter(r => (category === "Tout" || r.category === category) && normalize(`${r.name} ${r.description} ${t(r.description)} ${r.products.map(p => `${p.name} ${t(p.name)}`).join(" ")}`).includes(normalize(search))).sort((a, b) => sort === "fast" ? a.minutes - b.minutes : sort === "price" ? a.from - b.from : b.rating - a.rating), [category, search, sort, restaurants, locale]);
  function openRestaurant(r: Restaurant) { setSelectedId(r.id); setView("restaurant"); }
  function showProduct(p: Product) { if (!restaurant.acceptingOrders || !p.available) return; setProduct(p); setSelections(defaultSelections(p)); setQuantity(1); }
  function addLine(line: Line, replace = false) {
    if (submitting) {setNotice("La commande est en cours de confirmation.");return;}
    if (!replace && cart.length && cart[0].restaurantId !== line.restaurantId) { setPending(line); return; }
    if (!replace && (count + line.quantity > 100 || (cart.length >= 50 && !cart.some(item => item.key === line.key)))) { setNotice("Le panier est limité à 100 articles et 50 lignes."); return; }
    if (!replace && (cart.find(item => item.key === line.key)?.quantity || 0) + line.quantity > 20) { setNotice("Maximum 20 articles identiques. Ajustez la quantité dans votre panier."); return; }
    setCart(current => {
      const source = replace ? [] : current;
      return source.some(l => l.key === line.key) ? source.map(l => l.key === line.key ? { ...l, quantity: Math.min(20, l.quantity + line.quantity) } : l) : [...source, line];
    });
    setNotice({source: "{name} ajouté au panier", params: {name: line.name}});
  }
  function addProduct() {
    if (!product) return;
    if (!restaurant.acceptingOrders || !restaurant.products.find(item => item.id === product.id)?.available) {setProduct(null);setNotice("Ce plat n’est plus disponible pour le moment.");return;}
    if (productOutdated || !selectionsValid(product, selections)) return;
    addLine(makeLine(selectedId, product, selections, quantity));
    setProduct(null);
  }
  function changeQuantity(key: string, change: number) { if (submitting || updatingCart || (change > 0 && count >= 100)) return; setCart(current => current.map(l => l.key === key ? { ...l, quantity: Math.min(20, l.quantity + change) } : l).filter(l => l.quantity > 0)); }
  function toggleChoice(groupId: string, choiceId: string) {
    const group = product?.optionGroups.find(item => item.id === groupId);
    if (!group) return;
    setSelections(current => {
      const chosen = current.find(item => item.groupId === groupId)?.choiceIds || [];
      const next = chosen.includes(choiceId) ? chosen.filter(id => id !== choiceId) : group.max === 1 ? [choiceId] : chosen.length < group.max ? [...chosen, choiceId] : chosen;
      return [...current.filter(item => item.groupId !== groupId), {groupId, choiceIds: next}];
    });
  }
  async function updateCart() {
    if (submitting || updatingCart) return;
    setUpdatingCart(true); setOrderError("");
    try {
      const catalog = await refreshCatalog();
      setCart(current => {
        const next = new Map<string, Line>();
        for (const line of current) {
          const item = catalog.find(rest => rest.id === line.restaurantId)?.products.find(item => item.id === line.productId);
          if (!item || item.archived || !item.available || !selectionsValid(item, line.selections)) continue;
          const fresh = makeLine(line.restaurantId, item, line.selections, line.quantity);
          const previous = next.get(fresh.key);
          next.set(fresh.key, {...fresh, quantity: Math.min(20, fresh.quantity + (previous?.quantity || 0))});
        }
        return [...next.values()];
      });
      setNotice("Panier actualisé. Vérifiez le nouveau total avant de confirmer.");
    } catch (error) { setOrderError((error as Error).message); }
    finally { setUpdatingCart(false); }
  }
  async function checkPromo(code: string, silent = false) {
    if (!context || !cartRestaurant) return;
    const sequence = ++promoSequence.current;
    const checkedContext = context;
    setPromoBusy(true); setPromoError("");
    try {
      const data = await api<{promotion: Promotion}>("/api/promotions/check", {method: "POST", accountId:user?.id, body: JSON.stringify({code, restaurantId: cartRestaurant.id, city, subtotal})});
      if (sequence !== promoSequence.current || promoIdentity.current.context !== checkedContext || promoIdentity.current.code !== code) return;
      setQuote({context: checkedContext, promotion: data.promotion});
      if (!silent) setNotice({source: "Code {code} appliqué", params: {code: data.promotion.code}});
    } catch (error) {
      if (sequence !== promoSequence.current || promoIdentity.current.context !== checkedContext || promoIdentity.current.code !== code) return;
      setQuote(null); setAppliedCode(""); setPromoError((error as Error).message);
    } finally { if (sequence === promoSequence.current) setPromoBusy(false); }
  }
  function applyPromo() {
    const code = promoCode.trim().toUpperCase();
    if (!code || promoBusy || submittingRef.current) return;
    if (user?.role !== "client") { setPromoError("Connectez-vous au compte client pour vérifier ce code."); onAccount("client"); return; }
    ++promoSequence.current; setQuote(null); setAppliedCode(code); setPromoError("");
  }
  function clearPromo() { ++promoSequence.current; setQuote(null); setAppliedCode(""); setPromoCode(""); setPromoError(""); setPromoBusy(false); }
  useEffect(() => {
    ++promoSequence.current;
    if (!appliedCode || !context) { setPromoBusy(false); if (!context && appliedCode) { setQuote(null); setAppliedCode(""); } return; }
    // No old discount is usable while the destination, account or basket is being checked.
    setPromoBusy(true);
    const timer = window.setTimeout(() => void checkPromo(appliedCode, !!quote), 180);
    return () => { window.clearTimeout(timer); ++promoSequence.current; };
    // The request is tied to this complete price snapshot; quote updates must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedCode, context]);
  function renderPromo() {
    return <div className="promo-block" role="group" aria-label={t("Code de réduction")}>
      {appliedCode ? <div className="promo-applied"><Tag size={16}/><span><strong>{appliedCode}</strong><small>{promoPending ? t("Vérification pour ce panier…") : t(promotion?.label || "")}</small></span><b>{promoPending ? "…" : `− ${money(discount)}`}</b><button type="button" onClick={clearPromo} disabled={submitting}>{t("Retirer")}</button></div>
        : <div className="promo-form">
            <Input aria-label={t("Code promo")} placeholder={t("Code promo")} value={promoCode} maxLength={24} disabled={submitting}
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); applyPromo(); } }}
              onChange={event => { setPromoCode(event.target.value.toUpperCase()); setPromoError(""); }}/>
            <Button type="button" variant="outline" onClick={applyPromo} disabled={promoBusy || submitting || !promoCode.trim()}>{t("Appliquer")}</Button>
          </div>}
      {promoError && <p className="checkout-error" role="alert">{t(promoError)}</p>}
    </div>;
  }
  function requestCancel(order: Order) {
    setHistoryOpen(false); setCancelOrder(order); setCancelReason(""); setCancelError("");
  }
  async function confirmCancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!cancelOrder || cancellingRef.current || user?.role !== "client") return;
    const userId = user.id;
    const session = accountSession.current;
    const isCurrent = () => activeUser.current === userId && accountSession.current === session;
    cancellingRef.current = true; setCancelling(true); setCancelError(""); ++orderSequence.current;
    try {
      const result = await api<{order: Order}>(`/api/orders/${encodeURIComponent(cancelOrder.id)}`, {method:"PATCH", accountId:userId, body:JSON.stringify({status:"cancelled", reason:cancelReason.trim()})});
      if (!isCurrent()) return;
      setOrders(current => current.map(order => order.id === result.order.id ? result.order : order));
      setCurrentOrder(current => current?.id === result.order.id ? result.order : current);
      setCancelOrder(null); setNotice("La commande a été annulée.");
    } catch (error) { if (isCurrent()) setCancelError((error as Error).message); }
    finally { if (isCurrent()) { cancellingRef.current = false; setCancelling(false); void loadOrders(); } }
  }
  function renderCartUpdate() {
    return cartOutdated && <div className="cart-update" role="status"><strong>{t("La carte a changé")}</strong><p>{t("Actualisez les prix et options. Les articles indisponibles ou dont les options ont changé seront retirés ; vous pourrez les choisir à nouveau.")}</p><button type="button" disabled={updatingCart || submitting} onClick={() => void updateCart()}>{updatingCart ? t("Actualisation…") : t("Mettre à jour mon panier")}<RefreshCw size={15}/></button></div>;
  }
  function checkout() { if (cart.length && !cartUnavailable && !cartOutdated && !updatingCart && !promoPending && !submittingRef.current) { setCartOpen(false); setOrderError(""); setView("checkout"); if (!user) onAccount(); } }
  function openHistory() { if (user?.role === "client") setHistoryOpen(true); else if (user) onStaff(); else onAccount(); }
  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await placeOrder(false);
  }
  async function openPayment(order: Order) {
    if (paymentOpening.current || user?.role !== 'client') return;
    const accountId = user.id;
    const session = accountSession.current;
    const isCurrent = () => activeUser.current === accountId && accountSession.current === session;
    paymentOpening.current = true; setPaymentBusy(true); setPaymentError('');
    try {
      const result = await api<{checkoutUrl: string}>(`/api/orders/${order.id}/checkout`, {method:'POST', accountId, body:JSON.stringify({language:user.language})});
      if (!isCurrent()) return;
      const url = new URL(result.checkoutUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password) throw new Error('Le lien de paiement est invalide. Réessayez.');
      window.location.assign(url.href);
    } catch (cause) {if (isCurrent()) setPaymentError((cause as Error).message);}
    finally {if (isCurrent()) {paymentOpening.current = false; setPaymentBusy(false);}}
  }
  async function sendOrder(attempt: OrderRequest<Record<string, unknown>>, profile?: Record<string, unknown>) {
    if (submittingRef.current || user?.role !== 'client') return;
    const accountId = user.id;
    const session = accountSession.current;
    const isCurrent = () => activeUser.current === accountId && accountSession.current === session;
    ++orderSequence.current; submittingRef.current = true; setSubmitting(true); setOrdersLoading(false); setOrderError(''); setProfileSaveWarning(null);
    request.current = attempt; setPendingRequest(attempt); writePendingOrder(sessionStorage, accountId, attempt);
    try {
      const data = await api<{order: Order}>('/api/orders', {method: 'POST', accountId, body: JSON.stringify({...attempt.payload, requestId: attempt.id})});
      if (data.order.customerId !== accountId) throw new Error('Le compte connecté a changé. Réessayez.');
      if (!isCurrent()) return;
      clearPendingOrder(sessionStorage, accountId, attempt.id);
      request.current = null; setPendingRequest(null);
      setCurrentOrder(data.order); setOrders(current => [data.order, ...current.filter(order => order.id !== data.order.id)]);
      // The confirmed request may belong to a basket from before a reload.
      if (orderMatchesCart(attempt.payload, cart)) clearPromo();
      setCart(current => orderMatchesCart(attempt.payload, current) ? [] : current);
      setCartOpen(false); setView('success');
      if (profile) {
        // Saving defaults is optional and must not hold up the payment page.
        void onSaveProfile(profile).catch(() => { if (isCurrent()) setProfileSaveWarning(data.order.id); });
      }
      if (data.order.status === 'awaiting_payment') await openPayment(data.order);
    } catch (error) {
      const definitelyRejected = error instanceof ApiError && error.code === 'order_not_created';
      if (definitelyRejected) clearPendingOrder(sessionStorage, accountId, attempt.id);
      if (isCurrent()) {
        setOrderError((error as Error).message);
        if (definitelyRejected) { request.current = null; setPendingRequest(null); }
        if (error instanceof ApiError && error.status === 409 && appliedCode) { setQuote(null); void checkPromo(appliedCode, true); }
        void refreshCatalog().catch(() => {});
      }
    } finally { if (isCurrent()) { submittingRef.current = false; setSubmitting(false); } }
  }
  async function resumeOrder() {
    if (user?.role !== 'client') return;
    const pending = restoreOrderRequest(request.current, user.id);
    if (pending) await sendOrder(pending);
  }
  async function placeOrder(quick: boolean) {
    if (!cartRestaurant || submittingRef.current || cartUnavailable || cartOutdated || updatingCart || promoPending || !paymentReady) return;
    if (user?.role !== 'client') {onAccount(); return;}
    if (restoreOrderRequest(request.current, user.id)) {
      setOrderError('Reprenez la confirmation précédente avant de passer une nouvelle commande.'); return;
    }
    const customerName = (quick ? user.name : checkoutName).trim();
    const phoneDigits = (quick ? user.phone : checkoutPhone).replace(/[\s().-]/g, '');
    if (!/^\+?\d{10,15}$/.test(phoneDigits)) {setOrderError('Saisissez un numéro de téléphone valide, par exemple 0694 00 00 00.'); return;}
    if (customerName.length < 2) {setOrderError('Renseignez votre prénom et votre nom.'); return;}
    // A background tab can keep a render that predates the proof's expiry.
    const proof = confirmedCandidate && Date.parse(confirmedCandidate.expiresAt) > Date.now() ? confirmedCandidate : null;
    if (!savedAddressMatches(user.deliveryAddress, address, city) && !proof) {setOrderError('Confirmez le point de livraison avant de passer commande.'); return;}
    const payload = {
      restaurantId: cartRestaurant.id,
      expectedTotal: total,
      items: cart.map(line => ({productId: line.productId, quantity: line.quantity, selections: line.selections, unitPrice: line.price, productVersion: line.productVersion})),
      promoCode: promotion?.code || null,
      customerName, phone: phoneDigits,
      address: address.trim(), city, details: (quick ? user.deliveryAddress?.details || '' : details).trim(), notes: quick ? '' : notes.trim(), paymentMethod,
      ...(proof ? {addressVerificationToken:proof.verificationToken} : {useDefaultAddress:true}),
    };
    const attempt = prepareOrderRequest(null, user.id, payload, () => crypto.randomUUID());
    const profile = !quick && saveForNext ? {name:customerName, phone:phoneDigits, language:getLanguage(), paymentMethod,
      deliveryAddress:{address:payload.address, city, details:payload.details, ...(proof ? {verificationToken:proof.verificationToken} : {})}} : undefined;
    await sendOrder(attempt, profile);
  }
  useEffect(() => {
    const context = (document as unknown as { modelContext?: { registerTool: (tool: unknown, options: { signal: AbortSignal }) => unknown } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: unknown) => { try { Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch {} };
    register({ name: "get_demo_menus", description: "Read fictional restaurants and product prices in euro cents.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => restaurants });
    register({ name: "stage_demo_cart_item", description: "Add one classic item to the local demo basket, without placing an order or replacing an existing restaurant basket.", inputSchema: { type: "object", properties: { productId: { type: "string" } }, required: ["productId"], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async (input: unknown) => {
      if (!input || typeof input !== "object" || !("productId" in input) || typeof input.productId !== "string") throw new Error("A productId is required.");
      const rest = restaurants.find(r => r.products.some(p => p.id === input.productId));
      const item = rest?.products.find(p => p.id === input.productId);
      if (!rest || !item) throw new Error("Unknown product.");
      if (submitting) throw new Error("Order confirmation is in progress.");
      if (!rest.acceptingOrders || !item.available) throw new Error("This product is unavailable.");
      if (cart.length && cart[0].restaurantId !== rest.id) throw new Error("The basket contains another restaurant. Clear it in the interface first.");
      const defaults = defaultSelections(item);
      if (!selectionsValid(item, defaults)) throw new Error("Choose the required options in the product dialog first.");
      addLine(makeLine(rest.id, item, defaults, 1));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { staged: item.id, realOrderPlaced: false };
    }});
    return () => lifecycle.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, restaurants, submitting]);
  function startOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address.trim()) { setLocationOpen(true); return; }
    scrollToBlock(listRef.current);
  }
  function renderPendingOrder() {
    if (!pendingOrder || submitting) return null;
    const payload = pendingOrder.payload;
    const pendingRestaurant = restaurants.find(item => item.id === payload.restaurantId)?.name;
    const pendingItems = Array.isArray(payload.items) ? payload.items as Record<string, unknown>[] : [];
    return <div className="cart-update pending-order" role="region" aria-label={t('Confirmation à reprendre')}>
      <strong>{t('Confirmation à reprendre')}</strong>
      <p>{t('La réponse de votre dernière demande est incertaine. Reprenez sa confirmation avant de commander à nouveau.')}</p>
      <p><b>{pendingRestaurant || t('Commande précédente')}</b>{typeof payload.expectedTotal === 'number' && ` · ${money(payload.expectedTotal)}`}</p>
      {pendingItems.map((item, index) => {
        const product = restaurants.find(restaurant => restaurant.id === payload.restaurantId)?.products.find(product => product.id === item.productId && product.version === item.productVersion);
        const option = product ? makeLine(String(payload.restaurantId), product, item.selections as Selection[], Number(item.quantity)).option : '';
        return <p key={index}>{Number(item.quantity)} × {product ? t(product.name) : t('Article de la carte précédente')}{option && ` · ${t(option)}`} — {money(Number(item.unitPrice) * Number(item.quantity))}</p>;
      })}
      <p>{String(payload.customerName || '')} · {String(payload.phone || '')}<br/>{String(payload.address || '')}, {String(payload.city || '')}</p>
      {typeof payload.details === 'string' && payload.details && <p>{payload.details}</p>}
      {typeof payload.notes === 'string' && payload.notes && <p>{payload.notes}</p>}
      <p>{t(payload.paymentMethod === 'stripe' ? 'Paiement Stripe de test' : 'Simulation sans paiement')}</p>
      {orderError && <p className="checkout-error" role="alert">{t(orderError)}</p>}
      <Button type="button" onClick={() => void resumeOrder()}>{t('Reprendre cette confirmation')}</Button>
      <small>{t('La même demande sera vérifiée avec ses coordonnées, ses articles et son montant d’origine.')}</small>
    </div>;
  }
  function renderCartPanel() {
    const photo = (line: Line) => cartRestaurant?.products.find(item => item.id === line.productId)?.image;
    return <div className="cart-panel">
      <div className="cart-heading"><h2>{t("Votre panier")}</h2><span className="count-pill">{t(count > 1 ? "{count} articles" : "{count} article", {count})}</span></div>
      <div className="cart-body">
        {renderPendingOrder()}
        {!cart.length ? <div className="empty-cart"><span className="bag-illustration"><ShoppingBag size={34}/></span><h3>{t("Une petite faim ?")}</h3><p>{t("Il ne manque que vos envies.")}<br/>{t("Ajoutez un plat pour commencer.")}</p></div> : <>
          <button className="cart-restaurant" onClick={() => { if (cartRestaurant) openRestaurant(cartRestaurant); setCartOpen(false); }}><Utensils size={15}/><span>{t("Chez {restaurant} · {city}", {restaurant: cartRestaurant?.name || "", city: cartRestaurant?.pickupCity || city})}</span><ArrowRight size={15}/></button>
          <div className="cart-lines">{cart.map(line => <div className="cart-line" key={line.key}>
            <span className="cart-thumb">{photo(line) && <img src={photo(line)} alt=""/>}</span>
            <span className="line-title"><strong>{t(line.name)}</strong><b>{money(line.price * line.quantity)}</b>{line.option && <span className="line-option">{t(line.option)}</span>}</span>
            <span className="stepper small"><button disabled={submitting} aria-label={t(line.quantity > 1 ? "Retirer un {name}" : "Retirer {name} du panier", {name: t(line.name)})} onClick={() => changeQuantity(line.key, -1)}><Minus size={15}/></button><span>{line.quantity}</span><button disabled={submitting || line.quantity >= 20} aria-label={t("Ajouter un {name}", {name: t(line.name)})} onClick={() => changeQuantity(line.key, 1)}><Plus size={15}/></button></span>
          </div>)}</div>
          <div className="cart-delivery">
            <span>{t("Livraison")}</span>
            <div><MapPin size={16}/><span>{address || t("{city}, centre-ville", {city})}</span><button onClick={() => setLocationOpen(true)}>{t("Changer")}</button></div>
            <span className="cart-rule"/>
            <div><Clock3 size={16}/><span>{t("Au plus vite — {min} à {max} min", {min: cartRestaurant?.minutes || 25, max: (cartRestaurant?.minutes || 25) + 10})}</span></div>
          </div>
          {renderPromo()}
          {renderCartUpdate()}
          {cartUnavailable && <p className="checkout-error">{t("Le restaurant est en pause ou un article est indisponible. Retirez les articles indisponibles ou choisissez une autre adresse.")}</p>}
          <div className="cart-totals"><div><span>{t("Sous-total")}</span><span>{money(subtotal)}</span></div><div><span>{t("Livraison à {city}", {city})}</span><span>{money(delivery)}</span></div>{discount > 0 && <div className="promo-line"><span>{t("Remise {code}", {code: promotion?.code || ""})}</span><span>− {money(discount)}</span></div>}<div className="total"><strong>{t("Total")}</strong><strong>{money(total)}</strong></div></div>
        </>}
      </div>
      {!!cart.length && view !== 'checkout' && quickReady && <div className="quick-order-summary"><strong>{t('Prêt à commander en un clic')}</strong><p>{user?.name} · {user?.phone}</p><p>{address}, {city}{user?.deliveryAddress?.details && ` · ${user.deliveryAddress.details}`}</p><p>{t(paymentMethod === 'demo' ? 'Simulation sans paiement' : 'Carte bancaire · Apple Pay · Google Pay')}</p><button type="button" disabled={submitting} onClick={checkout}>{t('Modifier les coordonnées ou le paiement')}</button>{orderError && <p className="checkout-error" role="alert">{t(orderError)}</p>}</div>}
      {!!cart.length && view !== "checkout" && <div className="cart-foot"><Button disabled={submitting || !!pendingOrder || cartUnavailable || cartOutdated || updatingCart || promoPending} className="cart-checkout" onClick={() => quickReady ? void placeOrder(true) : checkout()}>{submitting ? t("Confirmation en cours…") : t(quickReady ? "Confirmer · {total}" : "Passer commande · {total}", {total: money(total)})}</Button></div>}
    </div>;
  }
  return <>
    <header className="site-header"><div className="header-inner">
      <button className="brand" aria-label={t("manjéo, accueil")} onClick={() => setView("home")}>manjéo</button>
      <nav className="desktop-nav"><button className={view === "home" || view === "restaurant" ? "active" : ""} onClick={() => setView("home")}>{t("Restaurants")}</button><button onClick={openHistory}>{t("Mes commandes")}</button></nav>
      <button disabled={submitting} className="location-button" aria-label={t("Adresse de livraison : {address}", {address: address ? `${address}, ${city}` : city})} onClick={() => setLocationOpen(true)}><MapPin size={15}/><strong>{address ? `${address}, ${city}` : city}</strong></button>
      <div className="header-actions">
        {user && user.role !== "client" && <button className="account-staff-button" onClick={onStaff}>{user.role === "admin" ? t("Administration") : user.role === "courier" ? t("Mes livraisons") : t("Mon restaurant")}</button>}
        <button className="account-header-button" aria-label={user ? t("Mon compte, {name}", {name: user.name}) : t("Se connecter")} onClick={() => onAccount()}><UserRound size={17}/><span>{user ? user.name : t("Se connecter")}</span></button>
        <button className="account-mobile-orders" aria-label={t("Mes commandes")} onClick={openHistory}><PackageCheck size={18}/></button>
        <button className="header-cart" aria-label={t(count > 1 ? "Ouvrir le panier, {count} articles, {total}" : "Ouvrir le panier, {count} article, {total}", {count, total: money(total)})} onClick={() => setCartOpen(true)}><ShoppingBag size={16}/>{money(total)}</button>
        {languageControl}
      </div>
    </div></header>
    {view === "home" && promises.length > 0 && <div className="promise-bar" role="group" aria-label={t("Nos promesses")}>
      <div className="promise-track">{[0, 1].map(run => <div className="promise-run" key={run} aria-hidden={run === 1 || undefined}>{promises.map(promise => <Fragment key={promise}><span>{promise}</span><span className="promise-dot"/></Fragment>)}</div>)}</div>
    </div>}
    {!!activeOrders.length && view !== 'success' && user?.role === 'client' && <section className="active-orders" aria-label={t('Commandes en cours')}>{activeOrders.map(order => <div className="active-order-card" key={order.id}><ShoppingBag size={23}/><div><strong>{t('Commande en cours')}</strong><p>{order.restaurant} · {t(statusLabels[order.status])}</p></div><Button variant="outline" onClick={() => {setCurrentOrder(order); setView('success');}}>{t('Voir le suivi')}</Button></div>)}</section>}
    <main className="page-shell">
      <div className="main-content">
        {renderPendingOrder()}
        {view === "home" && <>
          <section className="hero">
            <div className="hero-copy">
              <span className="hero-badge">{t("La Guyane a bon goût")}</span>
              <h1>{t("Le marché de Cayenne, livré chaud.")}</h1>
              <p>{t("{count} tables du centre, de Rémire-Montjoly et de Matoury. Vous commandez, un livreur du coin passe prendre votre plat et vous le pose chez vous.", {count: restaurants.length})}</p>
              <form className="hero-address" onSubmit={startOrder}><AddressField value={address} city={city} onChange={setAddress} onPick={suggestion => setCity(suggestion.city)} inputProps={{disabled: submitting, "aria-label": t("Votre adresse de livraison"), placeholder: t("Ex. 12 rue Lallouette, Cayenne"), maxLength: 180}}/><Button type="submit" disabled={submitting}>{t("Commander")}</Button></form>
            </div>
            {heroRestaurant && <div className="hero-visual">
              <div className="hero-photo"><img src={heroRestaurant.image} alt={t(heroRestaurant.imageAlt)}/></div>
              {heroProduct && <><div className="hero-sticker"><small>{t("Plat du jour")}</small><strong>{money(heroProduct.price)}</strong></div><p className="hero-caption"><strong>{t(heroProduct.name)}</strong> · {heroRestaurant.name}</p></>}
            </div>}
          </section>
          <div className="category-list" role="group" aria-label={t("Types de cuisine")}>
            <span className="category-label">{t("Une envie")}</span>
            {categories.filter(name => name !== "Tout").map(name => <button key={name} className={`category ${category === name ? "selected" : ""}`} onClick={() => setCategory(name)} aria-pressed={category === name}>{t(name)}</button>)}
            <button className="category-reset" onClick={() => { setCategory("Tout"); setSearch(""); }}>{t("Tout voir")}</button>
          </div>
          <section className="restaurants-section" ref={listRef}>
            <div className="section-heading">
              <h2>{search ? t("Résultats") : category === "Tout" ? t("Les restaurants") : t("Envie de {category} ?", {category: t(category)})}</h2>
              <span className="section-time">{t(filtered.length > 1 ? "{count} adresses près de vous" : "{count} adresse près de vous", {count: filtered.length})}</span>
              <div className="section-tools">
                <label className="search-box"><Search size={16}/><Input aria-label={t("Rechercher un restaurant ou un plat")} placeholder={t("Un resto, un plat, une envie…")} value={search} onChange={event => setSearch(event.target.value)}/>{search && <button aria-label={t("Effacer la recherche")} onClick={() => setSearch("")}><X size={14}/></button>}</label>
                <div className="sort-control" role="group" aria-label={t("Trier les restaurants")}>{sorts.map(option => <button key={option.id} className={sort === option.id ? "selected" : ""} aria-pressed={sort === option.id} onClick={() => setSort(option.id)}>{t(option.label)}</button>)}</div>
              </div>
            </div>
            <div className="restaurant-list">{filtered.slice(0, visible).map(r => <button className={`restaurant-row ${r.tag === "Coup de cœur" && r.acceptingOrders ? "featured" : ""}`} key={r.id} onClick={() => openRestaurant(r)}>
              <span className="restaurant-image"><img src={r.image} alt={t(r.imageAlt)} loading="lazy"/></span>
              <span className="restaurant-info">
                <span className="restaurant-title"><span className="restaurant-name">{r.name}</span>{(!r.acceptingOrders || r.tag === "Coup de cœur") && <span className={`restaurant-tag ${r.acceptingOrders ? "" : "paused"}`}>{r.acceptingOrders ? t(r.tag) : t("En pause")}</span>}</span>
                <span className="restaurant-desc">{t(r.description)} — {r.pickupCity || city}</span>
                <span className="restaurant-meta">★ {r.rating.toLocaleString(localeTag(), {minimumFractionDigits: 1})} · {t("{minutes} min · {price} de livraison", {minutes: r.minutes, price: money(r.delivery + surcharge)})}</span>
              </span>
              <span className="restaurant-action"><span className="restaurant-price">{t("dès {price}", {price: money(r.from)})}</span><span className="row-button">{t("Voir la carte")}</span></span>
            </button>)}</div>
            {!filtered.length && <div className="no-results"><Search size={32}/><h3>{t("Aucune adresse pour cette envie")}</h3><p>{t("Essayez « poulet », « burger » ou une autre cuisine.")}</p><Button variant="outline" onClick={() => { setSearch(""); setCategory("Tout"); }}>{t("Voir tous les restaurants")}</Button></div>}
            <div className="list-foot">
              <span>{t("Restaurants et produits fictifs — démonstration.")}</span>
              {filtered.length > visible && <Button variant="outline" onClick={() => setVisible(current => current + 2)}>{filtered.length - visible === 1 ? t("Le suivant") : t("Les deux suivants")}</Button>}
            </div>
          </section>
        </>}
        {view === "restaurant" && <>
          <div className="restaurant-hero">
            <img src={restaurant.image} alt={t(restaurant.imageAlt)}/>
            <div className="hero-controls">
              <button className="round-button" aria-label={t("Revenir à tous les restaurants")} onClick={() => setView("home")}><ChevronLeft size={18}/></button>
              <button className="round-button" aria-label={t(count > 1 ? "Ouvrir le panier, {count} articles" : "Ouvrir le panier, {count} article", {count})} onClick={() => setCartOpen(true)}><ShoppingBag size={18}/></button>
            </div>
          </div>
          <div className="restaurant-sheet">
            <div className="restaurant-detail-heading">
              <h1>{restaurant.name}</h1>
              <p>{t(restaurant.description)}</p>
              <div className="restaurant-detail-meta"><span>★ {restaurant.rating.toLocaleString(localeTag(), {minimumFractionDigits: 1})} <small>{t("(avis fictifs)")}</small> · {t("{min} à {max} min · {price} de livraison", {min: restaurant.minutes, max: restaurant.minutes + 10, price: money(restaurant.delivery + surcharge)})}</span><span className={`open-pill ${restaurant.acceptingOrders ? "" : "closed"}`}>{restaurant.acceptingOrders ? t("Ouvert") : t("En pause")}</span></div>
            </div>
            {groups.length > 1 && <div className="menu-tabs" role="group" aria-label={t("Groupes de la carte")}>{groups.map(group => <button key={group} className={(activeGroup || groups[0]) === group ? "selected" : ""} onClick={() => { setActiveGroup(group); scrollToBlock(groupRefs.current[group]); }}>{t(group)}</button>)}</div>}
            {!restaurant.acceptingOrders && <div className="catalog-closed">{t("Ce restaurant a mis les commandes en pause. Revenez un peu plus tard.")}</div>}
            {groups.map(group => <section className="menu-section" key={group} ref={element => { groupRefs.current[group] = element; }}>
              <h2>{t(group)}</h2>
              <div className="products-grid">{restaurant.products.filter(p => p.group === group).map(p => <button className={`product-card ${p.image ? "" : "no-photo"} ${p.popular ? "featured" : ""}`} disabled={!restaurant.acceptingOrders || !p.available} key={p.id} onClick={() => showProduct(p)}>
                <span className="product-body">
                  <span className="product-name">{t(p.name)}</span>
                  <span className="product-desc">{t(p.description)}</span>
                  {!p.available && <span className="availability-label">{t("Indisponible pour le moment")}</span>}
                  {p.available && p.popular && <span className="popular-label">{t("Le favori")}</span>}
                  {p.image && <span className="product-price">{money(p.price)}</span>}
                </span>
                {p.image ? <span className="product-photo"><img src={p.image} alt=""/><span className="add-circle"><Plus size={15}/></span></span> : <span className="product-price">{money(p.price)}</span>}
              </button>)}</div>
            </section>)}
            <p className="photo-note">{t("Photos d’illustration · restaurants et menus fictifs")}</p>
          </div>
        </>}
        {view === "checkout" && cart.length > 0 && <>
          <button className="back-link" onClick={() => { if (cartRestaurant) setSelectedId(cartRestaurant.id); setView("restaurant"); }}><ChevronLeft size={17}/> {t("Continuer mes achats")}</button>
          <div className="checkout-heading"><span className="eyebrow">{t("Presque à table")}</span><h1>{t("On vous livre où ?")}</h1><p>{t("Cette démo est partagée : utilisez des coordonnées fictives.")}</p></div>
          <div className="checkout-account-note"><UserRound size={19}/><div><strong>{user?.role === "client" ? t("Connecté en tant que {name}", {name: user.name}) : t("Un compte client pour passer commande")}</strong><p>{user?.role === "client" ? t("Votre commande sera transmise à l’espace restaurateur de cette démo.") : t("Utilisez client@manjeo.test pour tester votre première commande.")}</p></div><button onClick={() => onAccount(user?.role === "client" ? undefined : "client")}>{user?.role === "client" ? t("Mon compte") : t("Se connecter")}</button></div>
          <form key={user?.id || "guest"} className="checkout-form" onSubmit={submitOrder}>
            <section><h2><span>1</span> {t("Vos coordonnées")}</h2><div className="form-grid"><label>{t("Prénom et nom")}<Input disabled={submitting} value={checkoutName} onChange={event => { contactTouched.current.name = true; setCheckoutName(event.target.value); }} name="name" onInput={e => e.currentTarget.setCustomValidity("")} autoComplete="name" placeholder={t("Ex. Camille Dupont")} required minLength={2} maxLength={100}/></label><label>{t("Téléphone")}<Input disabled={submitting} name="phone" value={checkoutPhone} onChange={event => { contactTouched.current.phone = true; setCheckoutPhone(event.target.value); }} type="tel" autoComplete="tel" placeholder="0694 00 00 00" required onInput={e => e.currentTarget.setCustomValidity("")}/></label></div></section>
            <section><h2><span>2</span> {t("Adresse de livraison")}</h2><label>{t("Rue et numéro")}<AddressField value={address} city={city} onChange={setAddress} onPick={suggestion => setCity(suggestion.city)} inputProps={{disabled: submitting, "aria-label": t("Rue et numéro"), name: "address", placeholder: t("Ex. 12 avenue du Général de Gaulle"), required: true, minLength: 5, maxLength: 180, onInput: event => event.currentTarget.setCustomValidity("")}}/></label><div className="form-grid"><label>{t("Commune")}<select disabled={submitting} name="city" value={city} onChange={e => setCity(e.target.value)}>{cities.map(c => <option key={c}>{c}</option>)}</select></label><label>{t("Bâtiment, étage (facultatif)")}<Input disabled={submitting} name="details" value={details} onChange={event => setDetails(event.target.value)} placeholder={t("Bâtiment A, 2e étage")} maxLength={300}/></label></div><label>{t("Instructions de livraison (facultatif)")}<textarea disabled={submitting} name="notes" value={notes} onChange={event => setNotes(event.target.value)} placeholder={t("Un repère pour vous trouver plus facilement…")} rows={2} maxLength={300}/></label><div className="delivery-estimate"><Clock3 size={20}/><div><strong>{t("Préparation annoncée : {minutes} min", {minutes: cartRestaurant?.minutes || 25})}</strong><p>{t("Le suivi affichera une estimation de livraison après acceptation par le restaurant.")}</p></div></div></section>
            <AddressVerification userId={user?.role === 'client' ? user.id : undefined} address={address} city={city} saved={user?.deliveryAddress} selected={addressCandidate} disabled={submitting} onSelect={candidate => {setAddressCandidate(candidate); setAddress(candidate.address); setCity(candidate.city);}}/>
            <section><h2><span>3</span> {t('Mon moyen de paiement')}</h2><PaymentMethods value={paymentMethod} onChange={setPaymentMethod} config={paymentConfig} disabled={submitting}/></section>
            <label className="save-checkout-profile"><input type="checkbox" checked={saveForNext} disabled={submitting} onChange={event => setSaveForNext(event.target.checked)}/>{t('Enregistrer ces coordonnées pour mes prochaines commandes')}</label>
            {renderPromo()}
            <div className="checkout-mobile-total"><span>{t("Total, livraison incluse")}</span><strong>{money(total)}</strong></div>
            {renderCartUpdate()}
            {orderError && <p className="checkout-error" role="alert">{t(orderError)}</p>}
            {cartUnavailable && <p className="checkout-error" role="alert">{t("Un article ou le restaurant est devenu indisponible. Modifiez votre panier.")}</p>}
            <Button className="submit-order" type="submit" disabled={submitting || !!pendingOrder || user?.role !== "client" || cartUnavailable || cartOutdated || updatingCart || promoPending || (!savedDelivery && !confirmedCandidate) || !paymentReady}>{submitting ? t("Confirmation en cours…") : t("Confirmer · {total}", {total: money(total)})}</Button>
            <p className="demo-explanation">{t("Restaurants et produits fictifs. Commande enregistrée dans la démo partagée en ligne, sans paiement ni livraison réelle.")}</p>
          </form>
        </>}
        {view === "checkout" && !cart.length && <div className="no-results"><ShoppingBag size={32}/><h3>{t("Votre panier est vide")}</h3><Button onClick={() => setView("home")}>{t("Choisir un restaurant")}</Button></div>}
        {view === "success" && currentOrder && <div className="success-page">
          <div className="success-icon"><CheckCheck size={34}/></div>
          <span className="eyebrow">{t("Suivi de votre commande")}</span>
          <h1>{currentOrder.status === "awaiting_payment" ? t("Paiement à terminer") : currentOrder.status === "cancelled" ? t("Commande annulée.") : currentOrder.status === "delivered" ? t("Bon appétit !") : t("À table, bientôt.")}</h1>
          <p>{t("Le restaurant et le livreur partagent ici chaque étape de votre commande.")}</p>
          <div className="order-ticket">
            <div><span className="ticket-label">{t("Commande test")}</span><strong>{currentOrder.id}</strong></div>
            <span className="ticket-status">{t(statusLabels[currentOrder.status])}</span>
            <h2>{currentOrder.restaurant}</h2>
            {currentOrder.items.map((item, index) => <p key={index}>{item.quantity} × {t(item.name)}{item.option && ` (${t(item.option)})`}</p>)}
            {currentOrder.discount > 0 && <p className="ticket-discount">{t("Code {code} · remise de {discount}", {code: currentOrder.promoCode || "", discount: money(currentOrder.discount)})}</p>}
            <div className="ticket-total"><span>{t(currentOrder.count > 1 ? "{count} articles · Livraison à {city}" : "{count} article · Livraison à {city}", {count: currentOrder.count, city: currentOrder.city})}</span><strong>{money(currentOrder.total)}</strong></div>
            <OrderTracking order={currentOrder} onCancel={requestCancel}/>
          </div>
          {hasOrderConversation(currentOrder) && <OrderChat order={currentOrder} viewerId={user?.id || ""} language={user?.language || "fr"}/>}
          {profileSaveWarning === currentOrder.id && <p className="account-error" role="alert">{t('Votre commande est enregistrée, mais vos coordonnées n’ont pas pu être sauvegardées dans le compte.')}</p>}
          {currentOrder.status === 'awaiting_payment' && <div className="payment-followup"><strong>{t('Paiement à terminer')}</strong><p>{t('Votre commande sera envoyée au restaurant après confirmation du paiement de test.')}</p><Button disabled={paymentBusy} onClick={() => void openPayment(currentOrder)}>{t(paymentBusy ? 'Ouverture du paiement…' : 'Reprendre le paiement')}</Button>{paymentError && <p className="checkout-error" role="alert">{t(paymentError)}</p>}</div>}
          {ordersError && <p className="orders-error" role="alert">{t(ordersError)}</p>}
          <div className="success-info"><PackageCheck size={21}/><p>{t("Testez la préparation depuis le compte restaurant, puis la prise en charge depuis le compte livreur. Votre suivi s’actualise ici. Aucun paiement ni livraison réelle.")}</p></div>
          <Button onClick={() => setView("home")}>{t("Découvrir d’autres adresses")} <ArrowRight size={17}/></Button>
          <button className="text-link" onClick={openHistory}>{t("Voir mes commandes test")}</button>
        </div>}
      </div>
      <SiteFooter city={city} cities={cities} onCity={nextCity => { if (!submittingRef.current) setCity(nextCity); }} onAccount={onAccount} disabled={submitting} onOrders={openHistory}
        onNearby={() => { setView("home"); setCategory("Tout"); setSearch(""); window.setTimeout(() => scrollToBlock(listRef.current), 0); }}
        onStaff={role => { if (user && user.role !== "client" && (!role || user.role === role)) onStaff(); else onAccount(role); }}/>
    </main>
    {count > 0 && (view === "home" || view === "restaurant") && <div className="order-bar">
      <div><small>{t(count > 1 ? "{count} articles" : "{count} article", {count})}</small><strong>{money(total)}</strong></div>
      <Button variant="punch" onClick={() => setCartOpen(true)}>{t("Voir le panier")}</Button>
    </div>}
    <Sheet open={cartOpen} onOpenChange={setCartOpen}><SheetContent className="cart-sheet"><SheetTitle className="sr-only">{t("Votre panier")}</SheetTitle><SheetDescription className="sr-only">{t("Articles de votre commande de démonstration.")}</SheetDescription>{renderCartPanel()}</SheetContent></Sheet>
    <Dialog open={locationOpen} onOpenChange={open => { if (!submittingRef.current) setLocationOpen(open); }}><DialogContent className="app-dialog"><DialogTitle>{t("Où avez-vous faim ?")}</DialogTitle><DialogDescription>{t("Choisissez votre zone de livraison pour cette démo.")}</DialogDescription><form onSubmit={e => { e.preventDefault(); setLocationOpen(false); }} className="location-form"><label>{t("Commune")}<select disabled={submitting} value={city} onChange={e => setCity(e.target.value)}>{cities.map(c => <option key={c}>{c}</option>)}</select></label><label>{t("Adresse de livraison")}<AddressField value={address} city={city} onChange={setAddress} onPick={suggestion => setCity(suggestion.city)} inputProps={{disabled: submitting, "aria-label": t("Adresse de livraison"), placeholder: t("Ex. 12 rue Lallouette"), maxLength: 180}}/></label><p>{t("Cette adresse sert à la livraison et au calcul des frais : elle suit le panier et le formulaire de commande. Livraison majorée de 1 € à Rémire-Montjoly et Matoury dans cette démo.")}</p><Button type="submit" disabled={submitting}>{t("Valider mon adresse")} <MapPin size={16}/></Button></form></DialogContent></Dialog>
    <Dialog open={!!product} onOpenChange={open => { if (!open) setProduct(null); }}><DialogContent className="app-dialog product-dialog">{product && <>{product.image && <img className="dialog-product-image" src={product.image} alt={t(product.name)}/>}<div className="product-dialog-body"><span className="eyebrow">{restaurant.name}</span><DialogTitle>{t(product.name)}</DialogTitle><DialogDescription>{t(product.description)}</DialogDescription>
      <p className="product-allergens"><strong>{t("Allergènes :")}</strong> {t(product.allergens || "informations non renseignées dans cette démonstration.")}</p>
      {(product.optionGroups || []).map(group => <fieldset key={group.id} className="product-option-group"><legend>{t(group.name)}</legend><p className="option-rule">{group.min === group.max ? t(group.min > 1 ? "{count} choix obligatoires" : "{count} choix obligatoire", {count: group.min}) : group.min ? t("{min} à {max} choix", {min: group.min, max: group.max}) : t("Facultatif · jusqu’à {max} choix", {max: group.max})}</p><div className="dynamic-options">{group.choices.map(choice => {
        const selected = selections.find(selection => selection.groupId === group.id)?.choiceIds || [];
        const checked = selected.includes(choice.id);
        return <label key={choice.id} className={checked ? "chosen" : ""}><input type={group.max === 1 ? "radio" : "checkbox"} name={`option-${group.id}`} checked={checked} disabled={!checked && group.max > 1 && selected.length >= group.max} onChange={() => toggleChoice(group.id, choice.id)}/><span>{t(choice.name)}</span><b>{choice.price ? `+ ${money(choice.price)}` : t("Inclus")}</b></label>;
      })}</div>{group.min === 0 && group.max === 1 && <button type="button" className="option-clear" onClick={() => setSelections(current => current.map(selection => selection.groupId === group.id ? {...selection,choiceIds:[]} : selection))}>{t("Sans cette option")}</button>}</fieldset>)}
      {productOutdated && <div className="cart-update" role="alert"><p>{t("Ce produit a changé depuis son ouverture.")}</p><button type="button" onClick={() => {setProduct(productCurrent?.available ? productCurrent : null); if (productCurrent) setSelections(defaultSelections(productCurrent));}}>{productCurrent?.available ? t("Actualiser ce produit") : t("Retour à la carte")}</button></div>}
      <div className="add-product-row"><div className="stepper"><button disabled={quantity <= 1} aria-label={t("Diminuer la quantité")} onClick={() => setQuantity(q => Math.max(1,q-1))}><Minus size={17}/></button><span aria-live="polite">{quantity}</span><button disabled={quantity >= 20} aria-label={t("Augmenter la quantité")} onClick={() => setQuantity(q => Math.min(20,q+1))}><Plus size={17}/></button></div><Button onClick={addProduct} disabled={submitting || productOutdated || !selectionsValid(product,selections)}>{t("Ajouter · {total}", {total: money(selectionPrice(product,selections)*quantity)})}</Button></div>
      {!selectionsValid(product,selections) && <p className="option-rule" role="status">{t("Complétez les choix obligatoires pour ajouter ce plat.")}</p>}
    </div></>}</DialogContent></Dialog>
    <Dialog open={!!pending} onOpenChange={open => { if (!open) setPending(null); }}><DialogContent className="app-dialog"><DialogTitle>{t("Une nouvelle bonne adresse ?")}</DialogTitle><DialogDescription>{t("Une commande se fait auprès d’un seul restaurant. Ajouter ce plat remplacera votre panier de {restaurant}.", {restaurant: cartRestaurant?.name || ""})}</DialogDescription><Button onClick={() => { if (pending) addLine(pending, true); setPending(null); }}>{t("Remplacer le panier")}</Button><Button variant="outline" onClick={() => setPending(null)}>{t("Garder mon panier actuel")}</Button></DialogContent></Dialog>
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent className="app-dialog history-dialog"><DialogTitle>{t("Mes commandes")}</DialogTitle><DialogDescription>{t("Vos commandes enregistrées en base, avec leur suivi restaurant.")}</DialogDescription><div className="history-refresh"><span>{t("Mise à jour automatique · 8 s")}</span><button disabled={ordersLoading} onClick={() => void loadOrders()}><RefreshCw size={14}/>{ordersLoading ? t("Actualisation…") : t("Actualiser")}</button></div>{ordersError && <p className="orders-error" role="alert">{t(ordersError)}</p>}{orders.length ? <div className="order-history">{orders.map(order => <div className="history-order" key={order.id}><span className="history-icon"><ShoppingBag size={21}/></span><div><strong>{order.restaurant}</strong><p>{order.id} · {formatDate(order.date, {dateStyle:"short",timeStyle:"short"})}</p><span className="order-status" data-status={order.status}>{t(statusLabels[order.status])}</span><OrderTracking order={order} onCancel={requestCancel}/>{hasOrderConversation(order) && <button className="text-link" onClick={() => { setCurrentOrder(order); setHistoryOpen(false); setView("success"); }}>{unread[order.id] ? t(unread[order.id] > 1 ? "Ouvrir la conversation · {count} non lus" : "Ouvrir la conversation · {count} non lu", {count: unread[order.id]}) : t("Ouvrir la conversation")}</button>}<details><summary>{t("Articles commandés et adresse")}</summary>{order.items.map((item, index) => <p key={index}>{item.quantity} × {t(item.name)}{item.option && ` · ${t(item.option)}`} — {money(item.price * item.quantity)}</p>)}<p className="order-destination">{order.address}, {order.city}<br/>{t("Livraison : {price}", {price: money(order.delivery)})}{order.discount > 0 && <><br/>{t("Remise {code} : − {discount}", {code: order.promoCode || "", discount: money(order.discount)})}</>}</p>{order.history.map((step,index) => <p key={index}>{tEvent(step.label || statusLabels[step.status])} · {formatDate(step.date, {hour:"2-digit",minute:"2-digit"})}</p>)}</details></div><b>{money(order.total)}</b></div>)}</div> : ordersLoading ? <p className="orders-loading">{t("Vos commandes arrivent…")}</p> : !ordersError && <div className="no-orders"><ShoppingBag size={34}/><h3>{t("Votre première envie vous attend.")}</h3><p>{t("Vos commandes test apparaîtront ici.")}</p><Button onClick={() => { setHistoryOpen(false); setView("home"); }}>{t("Explorer les restaurants")}</Button></div>}</DialogContent></Dialog>
    <Dialog open={!!cancelOrder} onOpenChange={open => {if (!open && !cancelling) setCancelOrder(null);}}><DialogContent className="app-dialog cancel-dialog"><DialogTitle>{t("Annuler votre commande ?")}</DialogTitle><DialogDescription>{t("Vous pouvez l’annuler tant que le restaurant ne l’a pas acceptée. Le statut est vérifié au moment de votre demande.")}</DialogDescription><form onSubmit={confirmCancel}><label>{t("Motif de l’annulation")}<textarea required minLength={3} maxLength={250} value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder={t("Ex. Je souhaite modifier ma commande")}/></label>{cancelError && <p role="alert" className="checkout-error">{t(cancelError)}</p>}<Button type="submit" disabled={cancelling || cancelReason.trim().length < 3}>{cancelling ? t("Annulation…") : t("Confirmer l’annulation")}</Button></form></DialogContent></Dialog>
    <div className={`toast ${notice ? "visible" : ""}`} role="status" aria-live="polite">{notice && <><span><Check size={15}/></span>{typeof notice === "string" ? t(notice) : t(notice.source, Object.fromEntries(Object.entries(notice.params).map(([key, value]) => [key, typeof value === "string" ? t(value) : value])))}</>}</div>
  </>;
}
