"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bike, Check, CheckCheck, ChevronLeft, Clock3, CreditCard, MapPin, Minus, PackageCheck, Plus, Search, ShoppingBag, Tag, Utensils, UserRound, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { categories, money, type Restaurant, type Product, type Selection } from "@/lib/menu";
import { defaultSelections, selectionsValid, selectionPrice, makeLine, lineNeedsUpdate, validStoredLine, type CartLine as Line } from "@/lib/cart";
import "./customer-flow.css";
import OrderTracking from "./order-tracking";
import AddressField from "./address-field";
import OrderChat from "./order-chat";
import SiteFooter from "./site-footer";
import { promotionContext, quotedDiscount } from "./customer-state";

import { api, ApiError, statusLabels, type Order, type Promotion, type PublicPromotion, type User, type Role } from "@/lib/api";

type View = "home" | "restaurant" | "checkout" | "success";
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const cities = ["Cayenne", "Rémire-Montjoly", "Matoury"];
const sorts = [{id: "recommended", label: "Recommandés"}, {id: "fast", label: "Le plus rapide"}, {id: "price", label: "Prix croissant"}];
const pageSize = 4;
// Les transitions restent fonctionnelles : aucun défilement animé quand le visiteur le refuse.
const scrollToBlock = (element: HTMLElement | null) => element?.scrollIntoView({behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start"});

export default function Home({user, restaurants, refreshCatalog, onAccount, onStaff}: {user: User | null; restaurants: Restaurant[]; refreshCatalog: () => Promise<Restaurant[]>; onAccount: (role?: Role) => void; onStaff: () => void}) {
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
  const [notice, setNotice] = useState("");
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
  const request = useRef({key: "", id: ""});
  const activeUser = useRef(user?.id);
  const orderSequence = useRef(0);
  const promoSequence = useRef(0);
  const submittingRef = useRef(false);
  const cancellingRef = useRef(false);
  const promoIdentity = useRef({context: "", code: ""});
  activeUser.current = user?.id;
  useEffect(() => () => { activeUser.current = undefined; ++orderSequence.current; ++promoSequence.current; }, []);
  useEffect(() => {
    const markRead = (event: Event) => {
      const detail = (event as CustomEvent<{orderId: string; viewerId: string}>).detail;
      if (detail?.viewerId === activeUser.current && typeof detail.orderId === "string") setUnread(current => ({...current, [detail.orderId]: 0}));
    };
    window.addEventListener("manjeo-thread-read", markRead);
    return () => window.removeEventListener("manjeo-thread-read", markRead);
  }, []);
  const loadOrders = useCallback(async () => {
    if (user?.role !== "client") return;
    const userId = user.id;
    const sequence = ++orderSequence.current;
    setOrdersLoading(true);
    try {
      const data = await api<{orders: Order[]; unread: Record<string, number>}>("/api/orders");
      if (activeUser.current !== userId || sequence !== orderSequence.current) return;
      setOrders(data.orders); setUnread(data.unread || {}); setOrdersError("");
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
    ...offers.slice(0, 2).map(offer => offer.label),
    `Livraison dès ${money(Math.min(...restaurants.map(item => item.delivery)) + surcharge)}`,
    `${openNow} table${openNow > 1 ? "s" : ""} ouverte${openNow > 1 ? "s" : ""} maintenant`,
    `${Math.min(...restaurants.map(item => item.minutes))} à ${Math.max(...restaurants.map(item => item.minutes + 10))} min chrono`,
    "Cuisiné à Cayenne",
  ] : [];
  useEffect(() => {
    try {
      const savedRequest = JSON.parse(sessionStorage.getItem("manjeo-request-v1") || "null");
      if (savedRequest && typeof savedRequest.key === "string" && typeof savedRequest.id === "string") request.current = savedRequest;
    } catch {}
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
  useEffect(() => { if (ready) { try { localStorage.setItem("manjeo-location-v1", JSON.stringify({ city, address })); } catch {} } }, [city, address, ready]);
  useEffect(() => {
    contactTouched.current = {name: false, phone: false}; setCheckoutName(user?.role === "client" ? user.name : ""); setCheckoutPhone(user?.role === "client" ? user.phone || "" : "");
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
    if (user?.role !== "client" || (!historyOpen && view !== "success")) return;
    void loadOrders();
    const timer = window.setInterval(() => void loadOrders(), 8000);
    return () => window.clearInterval(timer);
  }, [historyOpen, view, loadOrders, user?.role]);
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
  const filtered = useMemo(() => restaurants.filter(r => (category === "Tout" || r.category === category) && normalize(`${r.name} ${r.description} ${r.products.map(p => p.name).join(" ")}`).includes(normalize(search))).sort((a, b) => sort === "fast" ? a.minutes - b.minutes : sort === "price" ? a.from - b.from : b.rating - a.rating), [category, search, sort, restaurants]);
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
    setNotice(`${line.name} ajouté au panier`);
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
      const data = await api<{promotion: Promotion}>("/api/promotions/check", {method: "POST", body: JSON.stringify({code, restaurantId: cartRestaurant.id, city, subtotal})});
      if (sequence !== promoSequence.current || promoIdentity.current.context !== checkedContext || promoIdentity.current.code !== code) return;
      setQuote({context: checkedContext, promotion: data.promotion});
      if (!silent) setNotice(`Code ${data.promotion.code} appliqué`);
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
    return <div className="promo-block" role="group" aria-label="Code de réduction">
      {appliedCode ? <div className="promo-applied"><Tag size={16}/><span><strong>{appliedCode}</strong><small>{promoPending ? "Vérification pour ce panier…" : promotion?.label}</small></span><b>{promoPending ? "…" : `− ${money(discount)}`}</b><button type="button" onClick={clearPromo} disabled={submitting}>Retirer</button></div>
        : <div className="promo-form">
            <Input aria-label="Code promo" placeholder="Code promo" value={promoCode} maxLength={24} disabled={submitting}
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); applyPromo(); } }}
              onChange={event => { setPromoCode(event.target.value.toUpperCase()); setPromoError(""); }}/>
            <Button type="button" variant="outline" onClick={applyPromo} disabled={promoBusy || submitting || !promoCode.trim()}>Appliquer</Button>
          </div>}
      {promoError && <p className="checkout-error" role="alert">{promoError}</p>}
    </div>;
  }
  function requestCancel(order: Order) {
    setHistoryOpen(false); setCancelOrder(order); setCancelReason(""); setCancelError("");
  }
  async function confirmCancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!cancelOrder || cancellingRef.current || user?.role !== "client") return;
    const userId = user.id;
    cancellingRef.current = true; setCancelling(true); setCancelError(""); ++orderSequence.current;
    try {
      const result = await api<{order: Order}>(`/api/orders/${encodeURIComponent(cancelOrder.id)}`, {method:"PATCH", body:JSON.stringify({status:"cancelled", reason:cancelReason.trim()})});
      if (activeUser.current !== userId) return;
      setOrders(current => current.map(order => order.id === result.order.id ? result.order : order));
      setCurrentOrder(current => current?.id === result.order.id ? result.order : current);
      setCancelOrder(null); setNotice("La commande a été annulée.");
    } catch (error) { if (activeUser.current === userId) setCancelError((error as Error).message); }
    finally { if (activeUser.current === userId) { cancellingRef.current = false; setCancelling(false); void loadOrders(); } }
  }
  function renderCartUpdate() {
    return cartOutdated && <div className="cart-update" role="status"><strong>La carte a changé</strong><p>Actualisez les prix et options. Les articles indisponibles ou dont les options ont changé seront retirés ; vous pourrez les choisir à nouveau.</p><button type="button" disabled={updatingCart || submitting} onClick={() => void updateCart()}>{updatingCart ? "Actualisation…" : "Mettre à jour mon panier"}<RefreshCw size={15}/></button></div>;
  }
  function checkout() { if (cart.length && !cartUnavailable && !cartOutdated && !updatingCart && !promoPending && !submittingRef.current) { setCartOpen(false); setOrderError(""); setView("checkout"); if (!user) onAccount(); } }
  function openHistory() { if (user?.role === "client") setHistoryOpen(true); else if (user) onStaff(); else onAccount(); }
  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cartRestaurant || submittingRef.current || cartUnavailable || cartOutdated || updatingCart || promoPending) return;
    if (user?.role !== "client") { onAccount(); return; }
    const form = new FormData(event.currentTarget);
    const phoneInput = event.currentTarget.elements.namedItem("phone") as HTMLInputElement;
    const phoneDigits = String(form.get("phone") || "").replace(/[\s().-]/g, "");
    if (!/^\+?\d{10,15}$/.test(phoneDigits)) {
      phoneInput.setCustomValidity("Saisissez un numéro de téléphone valide, par exemple 0694 00 00 00.");
      phoneInput.reportValidity();
      return;
    }
    for (const [field, min, message] of [["name", 2, "Renseignez votre prénom et votre nom."], ["address", 5, "Renseignez une adresse de livraison complète."]] as const) {
      if (String(form.get(field) || "").trim().length < min) {
        const input = event.currentTarget.elements.namedItem(field) as HTMLInputElement;
        input.setCustomValidity(message); input.reportValidity(); return;
      }
    }
    submittingRef.current = true; setSubmitting(true); setOrderError("");
    const payload = {
      restaurantId: cartRestaurant.id,
      expectedTotal: total,
      items: cart.map(line => ({productId: line.productId, quantity: line.quantity, selections: line.selections, unitPrice: line.price, productVersion: line.productVersion})),
      promoCode: promotion?.code || null,
      customerName: String(form.get("name") || "").trim(), phone: phoneDigits,
      address: address.trim(), city, details: String(form.get("details") || "").trim(), notes: String(form.get("notes") || "").trim(),
    };
    const key = JSON.stringify({userId: user.id, ...payload});
    if (request.current.key !== key) request.current = {key, id: crypto.randomUUID()};
    try { sessionStorage.setItem("manjeo-request-v1", JSON.stringify(request.current)); } catch {}
    try {
      const data = await api<{order: Order}>("/api/orders", {method: "POST", body: JSON.stringify({...payload, requestId: request.current.id})});
      if (activeUser.current !== user.id) return;
      setCurrentOrder(data.order); setOrders(current => [data.order, ...current.filter(order => order.id !== data.order.id)]);
      setCart([]); clearPromo(); setView("success"); request.current = {key: "", id: ""};
      try { sessionStorage.removeItem("manjeo-request-v1"); } catch {}
    } catch (error) {
      if (activeUser.current === user.id) {
        setOrderError((error as Error).message);
        if (error instanceof ApiError && error.status === 409 && appliedCode) { setQuote(null); void checkPromo(appliedCode, true); }
        void refreshCatalog().catch(() => {});
      }
    } finally { if (activeUser.current === user.id) { submittingRef.current = false; setSubmitting(false); } }
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
  function renderCartPanel() {
    const photo = (line: Line) => cartRestaurant?.products.find(item => item.id === line.productId)?.image;
    return <div className="cart-panel">
      <div className="cart-heading"><h2>Votre panier</h2><span className="count-pill">{count} article{count > 1 ? "s" : ""}</span></div>
      <div className="cart-body">
        {!cart.length ? <div className="empty-cart"><span className="bag-illustration"><ShoppingBag size={34}/></span><h3>Une petite faim ?</h3><p>Il ne manque que vos envies.<br/>Ajoutez un plat pour commencer.</p></div> : <>
          <button className="cart-restaurant" onClick={() => { if (cartRestaurant) openRestaurant(cartRestaurant); setCartOpen(false); }}><Utensils size={15}/><span>Chez <strong>{cartRestaurant?.name}</strong> · {cartRestaurant?.pickupCity || city}</span><ArrowRight size={15}/></button>
          <div className="cart-lines">{cart.map(line => <div className="cart-line" key={line.key}>
            <span className="cart-thumb">{photo(line) && <img src={photo(line)} alt=""/>}</span>
            <span className="line-title"><strong>{line.name}</strong><b>{money(line.price * line.quantity)}</b>{line.option && <span className="line-option">{line.option}</span>}</span>
            <span className="stepper small"><button disabled={submitting} aria-label={line.quantity > 1 ? `Retirer un ${line.name}` : `Retirer ${line.name} du panier`} onClick={() => changeQuantity(line.key, -1)}><Minus size={15}/></button><span>{line.quantity}</span><button disabled={submitting || line.quantity >= 20} aria-label={`Ajouter un ${line.name}`} onClick={() => changeQuantity(line.key, 1)}><Plus size={15}/></button></span>
          </div>)}</div>
          <div className="cart-delivery">
            <span>Livraison</span>
            <div><MapPin size={16}/><span>{address || `${city}, centre-ville`}</span><button onClick={() => setLocationOpen(true)}>Changer</button></div>
            <span className="cart-rule"/>
            <div><Clock3 size={16}/><span>Au plus vite — {cartRestaurant?.minutes} à {(cartRestaurant?.minutes || 25) + 10} min</span></div>
          </div>
          {renderPromo()}
          {renderCartUpdate()}
          {cartUnavailable && <p className="checkout-error">Le restaurant est en pause ou un article est indisponible. Retirez les articles indisponibles ou choisissez une autre adresse.</p>}
          <div className="cart-totals"><div><span>Sous-total</span><span>{money(subtotal)}</span></div><div><span>Livraison à {city}</span><span>{money(delivery)}</span></div>{discount > 0 && <div className="promo-line"><span>Remise {promotion?.code}</span><span>− {money(discount)}</span></div>}<div className="total"><strong>Total</strong><strong>{money(total)}</strong></div></div>
        </>}
      </div>
      {!!cart.length && view !== "checkout" && <div className="cart-foot"><Button disabled={submitting || cartUnavailable || cartOutdated || updatingCart || promoPending} className="cart-checkout" onClick={checkout}>Passer commande · {money(total)}</Button></div>}
    </div>;
  }
  return <>
    <header className="site-header"><div className="header-inner">
      <button className="brand" aria-label="manjéo, accueil" onClick={() => setView("home")}>manjéo</button>
      <nav className="desktop-nav"><button className={view === "home" || view === "restaurant" ? "active" : ""} onClick={() => setView("home")}>Restaurants</button><button onClick={openHistory}>Mes commandes</button></nav>
      <div className="header-actions">
        <button disabled={submitting} className="location-button" aria-label={`Adresse de livraison : ${address ? `${address}, ${city}` : city}`} onClick={() => setLocationOpen(true)}><MapPin size={15}/><strong>{address ? `${address}, ${city}` : city}</strong></button>
        {user && user.role !== "client" && <button className="account-staff-button" onClick={onStaff}>{user.role === "admin" ? "Administration" : user.role === "courier" ? "Mes livraisons" : "Mon restaurant"}</button>}
        <button className="account-header-button" aria-label={user ? `Mon compte, ${user.name}` : "Se connecter"} onClick={() => onAccount()}><UserRound size={17}/><span>{user ? user.name : "Se connecter"}</span></button>
        <button className="account-mobile-orders" aria-label="Mes commandes" onClick={openHistory}><PackageCheck size={18}/></button>
        <button className="header-cart" aria-label={`Ouvrir le panier, ${count} article${count > 1 ? "s" : ""}, ${money(total)}`} onClick={() => setCartOpen(true)}><ShoppingBag size={16}/>{money(total)}</button>
      </div>
    </div></header>
    {view === "home" && promises.length > 0 && <div className="promise-bar" aria-label="Nos promesses">
      <div className="promise-track">{[0, 1].map(run => <div className="promise-run" key={run} aria-hidden={run === 1 || undefined}>{promises.map(promise => <Fragment key={promise}><span>{promise}</span><span className="promise-dot"/></Fragment>)}</div>)}</div>
    </div>}
    <main className="page-shell">
      <div className="main-content">
        {view === "home" && <>
          <section className="hero">
            <div className="hero-copy">
              <span className="hero-badge">La Guyane a bon goût</span>
              <h1>Le marché de Cayenne, livré chaud.</h1>
              <p>{restaurants.length} tables du centre, de Rémire-Montjoly et de Matoury. Vous commandez, un livreur du coin passe prendre votre plat et vous le pose chez vous.</p>
              <form className="hero-address" onSubmit={startOrder}><AddressField value={address} city={city} onChange={setAddress} onPick={suggestion => setCity(suggestion.city)} inputProps={{disabled: submitting, "aria-label": "Votre adresse de livraison", placeholder: "12 rue Lallouette, Cayenne", maxLength: 180}}/><Button type="submit" disabled={submitting}>Commander</Button></form>
            </div>
            {heroRestaurant && <div className="hero-visual">
              <div className="hero-photo"><img src={heroRestaurant.image} alt={heroRestaurant.imageAlt}/></div>
              {heroProduct && <><div className="hero-sticker"><small>Plat du jour</small><strong>{money(heroProduct.price)}</strong></div><p className="hero-caption"><strong>{heroProduct.name}</strong> · {heroRestaurant.name}</p></>}
            </div>}
          </section>
          <div className="category-list" aria-label="Types de cuisine">
            <span className="category-label">Une envie</span>
            {categories.filter(name => name !== "Tout").map(name => <button key={name} className={`category ${category === name ? "selected" : ""}`} onClick={() => setCategory(name)} aria-pressed={category === name}>{name}</button>)}
            <button className="category-reset" onClick={() => { setCategory("Tout"); setSearch(""); }}>Tout voir</button>
          </div>
          <section className="restaurants-section" ref={listRef}>
            <div className="section-heading">
              <h2>{search ? "Résultats" : category === "Tout" ? "Les restaurants" : `Envie de ${category.toLowerCase()} ?`}</h2>
              <span className="section-time">{filtered.length} adresse{filtered.length > 1 ? "s" : ""} près de vous</span>
              <div className="section-tools">
                <label className="search-box"><Search size={16}/><Input aria-label="Rechercher un restaurant ou un plat" placeholder="Un resto, un plat, une envie…" value={search} onChange={event => setSearch(event.target.value)}/>{search && <button aria-label="Effacer la recherche" onClick={() => setSearch("")}><X size={14}/></button>}</label>
                <div className="sort-control" aria-label="Trier les restaurants">{sorts.map(option => <button key={option.id} className={sort === option.id ? "selected" : ""} aria-pressed={sort === option.id} onClick={() => setSort(option.id)}>{option.label}</button>)}</div>
              </div>
            </div>
            <div className="restaurant-list">{filtered.slice(0, visible).map(r => <button className={`restaurant-row ${r.tag === "Coup de cœur" && r.acceptingOrders ? "featured" : ""}`} key={r.id} onClick={() => openRestaurant(r)}>
              <span className="restaurant-image"><img src={r.image} alt={r.imageAlt} loading="lazy"/></span>
              <span className="restaurant-info">
                <span className="restaurant-title"><span className="restaurant-name">{r.name}</span>{(!r.acceptingOrders || r.tag === "Coup de cœur") && <span className={`restaurant-tag ${r.acceptingOrders ? "" : "paused"}`}>{r.acceptingOrders ? r.tag : "En pause"}</span>}</span>
                <span className="restaurant-desc">{r.description} — {r.pickupCity || city}</span>
                <span className="restaurant-meta">★ {r.rating.toFixed(1).replace(".", ",")} · {r.minutes} min · {money(r.delivery + surcharge)} de livraison</span>
              </span>
              <span className="restaurant-action"><span className="restaurant-price">dès {money(r.from)}</span><span className="row-button">Voir la carte</span></span>
            </button>)}</div>
            {!filtered.length && <div className="no-results"><Search size={32}/><h3>Aucune adresse pour cette envie</h3><p>Essayez « poulet », « burger » ou une autre cuisine.</p><Button variant="outline" onClick={() => { setSearch(""); setCategory("Tout"); }}>Voir tous les restaurants</Button></div>}
            <div className="list-foot">
              <span>Restaurants et produits fictifs — démonstration.</span>
              {filtered.length > visible && <Button variant="outline" onClick={() => setVisible(current => current + 2)}>{filtered.length - visible === 1 ? "Le suivant" : "Les deux suivants"}</Button>}
            </div>
          </section>
        </>}
        {view === "restaurant" && <>
          <div className="restaurant-hero">
            <img src={restaurant.image} alt={restaurant.imageAlt}/>
            <div className="hero-controls">
              <button className="round-button" aria-label="Revenir à tous les restaurants" onClick={() => setView("home")}><ChevronLeft size={18}/></button>
              <button className="round-button" aria-label={`Ouvrir le panier, ${count} article${count > 1 ? "s" : ""}`} onClick={() => setCartOpen(true)}><ShoppingBag size={18}/></button>
            </div>
          </div>
          <div className="restaurant-sheet">
            <div className="restaurant-detail-heading">
              <h1>{restaurant.name}</h1>
              <p>{restaurant.description}</p>
              <div className="restaurant-detail-meta"><span>★ {restaurant.rating.toFixed(1).replace(".", ",")} <small>(avis fictifs)</small> · {restaurant.minutes} à {restaurant.minutes + 10} min · {money(restaurant.delivery + surcharge)} livraison</span><span className={`open-pill ${restaurant.acceptingOrders ? "" : "closed"}`}>{restaurant.acceptingOrders ? "Ouvert" : "En pause"}</span></div>
            </div>
            {groups.length > 1 && <div className="menu-tabs" aria-label="Groupes de la carte">{groups.map(group => <button key={group} className={(activeGroup || groups[0]) === group ? "selected" : ""} onClick={() => { setActiveGroup(group); scrollToBlock(groupRefs.current[group]); }}>{group}</button>)}</div>}
            {!restaurant.acceptingOrders && <div className="catalog-closed">Ce restaurant a mis les commandes en pause. Revenez un peu plus tard.</div>}
            {groups.map(group => <section className="menu-section" key={group} ref={element => { groupRefs.current[group] = element; }}>
              <h2>{group}</h2>
              <div className="products-grid">{restaurant.products.filter(p => p.group === group).map(p => <button className={`product-card ${p.image ? "" : "no-photo"} ${p.popular ? "featured" : ""}`} disabled={!restaurant.acceptingOrders || !p.available} key={p.id} onClick={() => showProduct(p)}>
                <span className="product-body">
                  <span className="product-name">{p.name}</span>
                  <span className="product-desc">{p.description}</span>
                  {!p.available && <span className="availability-label">Indisponible pour le moment</span>}
                  {p.available && p.popular && <span className="popular-label">Le favori</span>}
                  {p.image && <span className="product-price">{money(p.price)}</span>}
                </span>
                {p.image ? <span className="product-photo"><img src={p.image} alt=""/><span className="add-circle"><Plus size={15}/></span></span> : <span className="product-price">{money(p.price)}</span>}
              </button>)}</div>
            </section>)}
            <p className="photo-note">Photos d’illustration · restaurants et menus fictifs</p>
          </div>
        </>}
        {view === "checkout" && cart.length > 0 && <>
          <button className="back-link" onClick={() => { if (cartRestaurant) setSelectedId(cartRestaurant.id); setView("restaurant"); }}><ChevronLeft size={17}/> Continuer mes achats</button>
          <div className="checkout-heading"><span className="eyebrow">Presque à table</span><h1>On vous livre où ?</h1><p>Cette démo est partagée : utilisez des coordonnées fictives.</p></div>
          <div className="checkout-account-note"><UserRound size={19}/><div><strong>{user?.role === "client" ? `Connecté en tant que ${user.name}` : "Un compte client pour passer commande"}</strong><p>{user?.role === "client" ? "Votre commande sera transmise à l’espace restaurateur de cette démo." : "Utilisez client@manjeo.test pour tester votre première commande."}</p></div><button onClick={() => onAccount(user?.role === "client" ? undefined : "client")}>{user?.role === "client" ? "Mon compte" : "Se connecter"}</button></div>
          <form key={user?.id || "guest"} className="checkout-form" onSubmit={submitOrder}>
            <section><h2><span>1</span> Vos coordonnées</h2><div className="form-grid"><label>Prénom et nom<Input disabled={submitting} value={checkoutName} onChange={event => { contactTouched.current.name = true; setCheckoutName(event.target.value); }} name="name" onInput={e => e.currentTarget.setCustomValidity("")} autoComplete="name" placeholder="Camille Dupont" required minLength={2} maxLength={80}/></label><label>Téléphone<Input disabled={submitting} name="phone" value={checkoutPhone} onChange={event => { contactTouched.current.phone = true; setCheckoutPhone(event.target.value); }} type="tel" autoComplete="tel" placeholder="0694 00 00 00" required onInput={e => e.currentTarget.setCustomValidity("")}/></label></div></section>
            <section><h2><span>2</span> Adresse de livraison</h2><label>Rue et numéro<AddressField value={address} city={city} onChange={setAddress} onPick={suggestion => setCity(suggestion.city)} inputProps={{disabled: submitting, name: "address", placeholder: "12 avenue du Général de Gaulle", required: true, minLength: 5, maxLength: 180, onInput: event => event.currentTarget.setCustomValidity("")}}/></label><div className="form-grid"><label>Commune<select disabled={submitting} name="city" value={city} onChange={e => setCity(e.target.value)}>{cities.map(c => <option key={c}>{c}</option>)}</select></label><label>Bâtiment, étage (facultatif)<Input disabled={submitting} name="details" placeholder="Bâtiment A, 2e étage" maxLength={120}/></label></div><label>Instructions de livraison (facultatif)<textarea disabled={submitting} name="notes" placeholder="Un repère pour vous trouver plus facilement…" rows={2} maxLength={300}/></label><div className="delivery-estimate"><Clock3 size={20}/><div><strong>Préparation annoncée : {cartRestaurant?.minutes} min</strong><p>Le suivi affichera une estimation de livraison après acceptation par le restaurant.</p></div></div></section>
            <section><h2><span>3</span> Paiement de démonstration</h2><div className="payment-demo"><CreditCard size={23}/><div><strong>Carte de test</strong><p>Aucune carte bancaire requise. Aucun débit.</p></div><Check size={19}/></div></section>
            {renderPromo()}
            <div className="checkout-mobile-total"><span>Total, livraison incluse</span><strong>{money(total)}</strong></div>
            {renderCartUpdate()}
            {orderError && <p className="checkout-error" role="alert">{orderError}</p>}
            {cartUnavailable && <p className="checkout-error" role="alert">Un article ou le restaurant est devenu indisponible. Modifiez votre panier.</p>}
            <Button className="submit-order" type="submit" disabled={submitting || user?.role !== "client" || cartUnavailable || cartOutdated || updatingCart || promoPending}>{submitting ? "Confirmation en cours…" : `Confirmer · ${money(total)}`}</Button>
            <p className="demo-explanation">Restaurants et produits fictifs. Commande enregistrée dans la démo partagée en ligne, sans paiement ni livraison réelle.</p>
          </form>
        </>}
        {view === "checkout" && !cart.length && <div className="no-results"><ShoppingBag size={32}/><h3>Votre panier est vide</h3><Button onClick={() => setView("home")}>Choisir un restaurant</Button></div>}
        {view === "success" && currentOrder && <div className="success-page">
          <div className="success-icon"><CheckCheck size={34}/></div>
          <span className="eyebrow">Suivi de votre commande</span>
          <h1>{currentOrder.status === "cancelled" ? "Commande annulée." : currentOrder.status === "delivered" ? "Bon appétit !" : "À table, bientôt."}</h1>
          <p>Le restaurant et le livreur partagent ici chaque étape de votre commande.</p>
          <div className="order-ticket">
            <div><span className="ticket-label">Commande test</span><strong>{currentOrder.id}</strong></div>
            <span className="ticket-status">{statusLabels[currentOrder.status]}</span>
            <h2>{currentOrder.restaurant}</h2>
            {currentOrder.items.map((item, index) => <p key={index}>{item.quantity} × {item.name}{item.option && ` (${item.option})`}</p>)}
            {currentOrder.discount > 0 && <p className="ticket-discount">Code {currentOrder.promoCode} · remise de {money(currentOrder.discount)}</p>}
            <div className="ticket-total"><span>{currentOrder.count} article{currentOrder.count > 1 ? "s" : ""} · Livraison à {currentOrder.city}</span><strong>{money(currentOrder.total)}</strong></div>
            <OrderTracking order={currentOrder} onCancel={requestCancel}/>
          </div>
          {currentOrder.status !== "pending" && currentOrder.status !== "cancelled" && <OrderChat order={currentOrder} viewerId={user?.id || ""} language={user?.language || "fr"}/>}
          {ordersError && <p className="orders-error" role="alert">{ordersError}</p>}
          <div className="success-info"><PackageCheck size={21}/><p>Testez la préparation depuis le compte restaurant, puis la prise en charge depuis le compte livreur. Votre suivi s’actualise ici. Aucun paiement ni livraison réelle.</p></div>
          <Button onClick={() => setView("home")}>Découvrir d’autres adresses <ArrowRight size={17}/></Button>
          <button className="text-link" onClick={openHistory}>Voir mes commandes test</button>
        </div>}
      </div>
      <SiteFooter city={city} cities={cities} onCity={nextCity => { if (!submittingRef.current) setCity(nextCity); }} onAccount={onAccount} disabled={submitting} onOrders={openHistory}
        onNearby={() => { setView("home"); setCategory("Tout"); setSearch(""); window.setTimeout(() => scrollToBlock(listRef.current), 0); }}
        onStaff={role => { if (user && user.role !== "client" && (!role || user.role === role)) onStaff(); else onAccount(role); }}/>
    </main>
    {count > 0 && (view === "home" || view === "restaurant") && <div className="order-bar">
      <div><small>{count} article{count > 1 ? "s" : ""}</small><strong>{money(total)}</strong></div>
      <Button variant="punch" onClick={() => setCartOpen(true)}>Voir le panier</Button>
    </div>}
    <Sheet open={cartOpen} onOpenChange={setCartOpen}><SheetContent className="cart-sheet"><SheetTitle className="sr-only">Votre panier</SheetTitle><SheetDescription className="sr-only">Articles de votre commande de démonstration.</SheetDescription>{renderCartPanel()}</SheetContent></Sheet>
    <Dialog open={locationOpen} onOpenChange={open => { if (!submittingRef.current) setLocationOpen(open); }}><DialogContent className="app-dialog"><DialogTitle>Où avez-vous faim ?</DialogTitle><DialogDescription>Choisissez votre zone de livraison pour cette démo.</DialogDescription><form onSubmit={e => { e.preventDefault(); setLocationOpen(false); }} className="location-form"><label>Commune<select disabled={submitting} value={city} onChange={e => setCity(e.target.value)}>{cities.map(c => <option key={c}>{c}</option>)}</select></label><label>Adresse de livraison<AddressField value={address} city={city} onChange={setAddress} onPick={suggestion => setCity(suggestion.city)} inputProps={{disabled: submitting, placeholder: "12 rue Lallouette", maxLength: 180}}/></label><p>Cette adresse sert à la livraison et au calcul des frais : elle suit le panier et le formulaire de commande. Livraison majorée de 1 € à Rémire-Montjoly et Matoury dans cette démo.</p><Button type="submit" disabled={submitting}>Valider mon adresse <MapPin size={16}/></Button></form></DialogContent></Dialog>
    <Dialog open={!!product} onOpenChange={open => { if (!open) setProduct(null); }}><DialogContent className="app-dialog product-dialog">{product && <>{product.image && <img className="dialog-product-image" src={product.image} alt={product.name}/>}<div className="product-dialog-body"><span className="eyebrow">{restaurant.name}</span><DialogTitle>{product.name}</DialogTitle><DialogDescription>{product.description}</DialogDescription>
      <p className="product-allergens"><strong>Allergènes :</strong> {product.allergens || "informations non renseignées dans cette démonstration."}</p>
      {(product.optionGroups || []).map(group => <fieldset key={group.id} className="product-option-group"><legend>{group.name}</legend><p className="option-rule">{group.min === group.max ? `${group.min} choix ${group.min > 1 ? "obligatoires" : "obligatoire"}` : group.min ? `${group.min} à ${group.max} choix` : `Facultatif · jusqu’à ${group.max} choix`}</p><div className="dynamic-options">{group.choices.map(choice => {
        const selected = selections.find(selection => selection.groupId === group.id)?.choiceIds || [];
        const checked = selected.includes(choice.id);
        return <label key={choice.id} className={checked ? "chosen" : ""}><input type={group.max === 1 ? "radio" : "checkbox"} name={`option-${group.id}`} checked={checked} disabled={!checked && group.max > 1 && selected.length >= group.max} onChange={() => toggleChoice(group.id, choice.id)}/><span>{choice.name}</span><b>{choice.price ? `+ ${money(choice.price)}` : "Inclus"}</b></label>;
      })}</div>{group.min === 0 && group.max === 1 && <button type="button" className="option-clear" onClick={() => setSelections(current => current.map(selection => selection.groupId === group.id ? {...selection,choiceIds:[]} : selection))}>Sans cette option</button>}</fieldset>)}
      {productOutdated && <div className="cart-update" role="alert"><p>Ce produit a changé depuis son ouverture.</p><button type="button" onClick={() => {setProduct(productCurrent?.available ? productCurrent : null); if (productCurrent) setSelections(defaultSelections(productCurrent));}}>{productCurrent?.available ? "Actualiser ce produit" : "Retour à la carte"}</button></div>}
      <div className="add-product-row"><div className="stepper"><button disabled={quantity <= 1} aria-label="Diminuer la quantité" onClick={() => setQuantity(q => Math.max(1,q-1))}><Minus size={17}/></button><span aria-live="polite">{quantity}</span><button disabled={quantity >= 20} aria-label="Augmenter la quantité" onClick={() => setQuantity(q => Math.min(20,q+1))}><Plus size={17}/></button></div><Button onClick={addProduct} disabled={submitting || productOutdated || !selectionsValid(product,selections)}>Ajouter · {money(selectionPrice(product,selections)*quantity)}</Button></div>
      {!selectionsValid(product,selections) && <p className="option-rule" role="status">Complétez les choix obligatoires pour ajouter ce plat.</p>}
    </div></>}</DialogContent></Dialog>
    <Dialog open={!!pending} onOpenChange={open => { if (!open) setPending(null); }}><DialogContent className="app-dialog"><DialogTitle>Une nouvelle bonne adresse ?</DialogTitle><DialogDescription>Une commande se fait auprès d’un seul restaurant. Ajouter ce plat remplacera votre panier de {cartRestaurant?.name}.</DialogDescription><Button onClick={() => { if (pending) addLine(pending, true); setPending(null); }}>Remplacer le panier</Button><Button variant="outline" onClick={() => setPending(null)}>Garder mon panier actuel</Button></DialogContent></Dialog>
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent className="app-dialog history-dialog"><DialogTitle>Mes commandes</DialogTitle><DialogDescription>Vos commandes enregistrées en base, avec leur suivi restaurant.</DialogDescription><div className="history-refresh"><span>Mise à jour automatique · 8 s</span><button disabled={ordersLoading} onClick={() => void loadOrders()}><RefreshCw size={14}/>{ordersLoading ? "Actualisation…" : "Actualiser"}</button></div>{ordersError && <p className="orders-error" role="alert">{ordersError}</p>}{orders.length ? <div className="order-history">{orders.map(order => <div className="history-order" key={order.id}><span className="history-icon"><ShoppingBag size={21}/></span><div><strong>{order.restaurant}</strong><p>{order.id} · {new Date(order.date).toLocaleString("fr-FR", {dateStyle:"short",timeStyle:"short",timeZone:"America/Cayenne"})}</p><span className="order-status" data-status={order.status}>{statusLabels[order.status]}</span><OrderTracking order={order} onCancel={requestCancel}/>{order.status !== "pending" && order.status !== "cancelled" && <button className="text-link" onClick={() => { setCurrentOrder(order); setHistoryOpen(false); setView("success"); }}>Ouvrir la conversation{unread[order.id] ? ` · ${unread[order.id]} non lu${unread[order.id] > 1 ? "s" : ""}` : ""}</button>}<details><summary>Articles commandés et adresse</summary>{order.items.map((item, index) => <p key={index}>{item.quantity} × {item.name}{item.option && ` · ${item.option}`} — {money(item.price * item.quantity)}</p>)}<p className="order-destination">{order.address}, {order.city}<br/>Livraison : {money(order.delivery)}{order.discount > 0 && <><br/>Remise {order.promoCode} : − {money(order.discount)}</>}</p>{order.history.map((step,index) => <p key={index}>{step.label || statusLabels[step.status]} · {new Date(step.date).toLocaleTimeString("fr-FR", {timeZone:"America/Cayenne",hour:"2-digit",minute:"2-digit"})}</p>)}</details></div><b>{money(order.total)}</b></div>)}</div> : ordersLoading ? <p className="orders-loading">Vos commandes arrivent…</p> : !ordersError && <div className="no-orders"><ShoppingBag size={34}/><h3>Votre première envie vous attend.</h3><p>Vos commandes test apparaîtront ici.</p><Button onClick={() => { setHistoryOpen(false); setView("home"); }}>Explorer les restaurants</Button></div>}</DialogContent></Dialog>
    <Dialog open={!!cancelOrder} onOpenChange={open => {if (!open && !cancelling) setCancelOrder(null);}}><DialogContent className="app-dialog cancel-dialog"><DialogTitle>Annuler votre commande ?</DialogTitle><DialogDescription>Vous pouvez l’annuler tant que le restaurant ne l’a pas acceptée. Le statut est vérifié au moment de votre demande.</DialogDescription><form onSubmit={confirmCancel}><label>Motif de l’annulation<textarea required minLength={3} maxLength={250} value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder="Ex. Je souhaite modifier ma commande"/></label>{cancelError && <p role="alert" className="checkout-error">{cancelError}</p>}<Button type="submit" disabled={cancelling || cancelReason.trim().length < 3}>{cancelling ? "Annulation…" : "Confirmer l’annulation"}</Button></form></DialogContent></Dialog>
    <div className={`toast ${notice ? "visible" : ""}`} role="status" aria-live="polite">{notice && <><span><Check size={15}/></span>{notice}</>}</div>
  </>;
}
