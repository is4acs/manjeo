"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Bike, Check, CheckCheck, ChevronDown, Clock3, CreditCard, Flame, Heart, Leaf, MapPin, Minus, PackageCheck, Plus, Search, ShoppingBag, SlidersHorizontal, Sparkles, Star, Trash2, Utensils, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { restaurants, categories, money, type Restaurant, type Product } from "@/lib/menu";

type Line = { key: string; restaurantId: string; productId: string; name: string; option: string; price: number; quantity: number };
type Order = { id: string; restaurant: string; total: number; count: number; city: string; date: string; items: string[] };
type View = "home" | "restaurant" | "checkout" | "success";
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const cities = ["Cayenne", "Rémire-Montjoly", "Matoury"];

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [selectedId, setSelectedId] = useState("ti-kreol");
  const [category, setCategory] = useState("Tout");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recommended");
  const [cart, setCart] = useState<Line[]>([]);
  const [ready, setReady] = useState(false);
  const [city, setCity] = useState("Cayenne");
  const [address, setAddress] = useState("");
  const [locationOpen, setLocationOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [portion, setPortion] = useState("Classique");
  const [sauce, setSauce] = useState("Sans piment");
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState<Line | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const restaurant = restaurants.find(r => r.id === selectedId)!;
  const cartRestaurant = restaurants.find(r => r.id === cart[0]?.restaurantId);
  const subtotal = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const delivery = cartRestaurant ? cartRestaurant.delivery + (city === "Cayenne" ? 0 : 100) : 0;
  const total = subtotal + delivery;
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("manjeo-cart-v1") || "[]");
      if (Array.isArray(stored)) {
        const valid: Line[] = stored.filter((line: Line) => {
          const item = restaurants.find(r => r.id === line.restaurantId)?.products.find(p => p.id === line.productId);
          return item && typeof line.key === "string" && typeof line.option === "string" && typeof line.name === "string" && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 20 && (line.price === item.price || (item.large && line.price === item.price + 200));
        });
        setCart(valid.filter(l => l.restaurantId === valid[0]?.restaurantId));
      }
      const location = JSON.parse(localStorage.getItem("manjeo-location-v1") || "null");
      if (location && cities.includes(location.city)) {
        setCity(location.city);
        if (typeof location.address === "string") setAddress(location.address.slice(0, 180));
      }
      const saved = JSON.parse(localStorage.getItem("manjeo-orders-v1") || "[]");
      if (Array.isArray(saved)) setOrders(saved.filter(o => o && typeof o.id === "string" && typeof o.restaurant === "string" && typeof o.total === "number" && Array.isArray(o.items)).slice(0, 10));
    } catch { /* Reset damaged demo data. */ }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) { try { localStorage.setItem("manjeo-cart-v1", JSON.stringify(cart)); } catch {} } }, [cart, ready]);
  useEffect(() => { if (ready) { try { localStorage.setItem("manjeo-location-v1", JSON.stringify({ city, address })); } catch {} } }, [city, address, ready]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 3200); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [view, selectedId]);
  const filtered = useMemo(() => restaurants.filter(r => (category === "Tout" || r.category === category) && normalize(`${r.name} ${r.description} ${r.products.map(p => p.name).join(" ")}`).includes(normalize(search))).sort((a, b) => sort === "fast" ? a.minutes - b.minutes : sort === "price" ? a.from - b.from : b.rating - a.rating), [category, search, sort]);
  function openRestaurant(r: Restaurant) { setSelectedId(r.id); setView("restaurant"); }
  function showProduct(p: Product) { setProduct(p); setPortion("Classique"); setSauce("Sans piment"); setQuantity(1); }
  function addLine(line: Line, replace = false) {
    if (!replace && cart.length && cart[0].restaurantId !== line.restaurantId) { setPending(line); return; }
    setCart(current => {
      const source = replace ? [] : current;
      return source.some(l => l.key === line.key) ? source.map(l => l.key === line.key ? { ...l, quantity: Math.min(20, l.quantity + line.quantity) } : l) : [...source, line];
    });
    setNotice(`${line.name} ajouté au panier`);
  }
  function addProduct() {
    if (!product) return;
    const option = product.large ? `${portion} · ${sauce}` : "";
    addLine({ key: `${product.id}-${option}`, restaurantId: selectedId, productId: product.id, name: product.name, option, price: product.price + (product.large && portion === "Gros appétit" ? 200 : 0), quantity });
    setProduct(null);
  }
  function changeQuantity(key: string, change: number) { setCart(current => current.map(l => l.key === key ? { ...l, quantity: Math.min(20, l.quantity + change) } : l).filter(l => l.quantity > 0)); }
  function checkout() { if (cart.length) { setCartOpen(false); setView("checkout"); } }
  function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cartRestaurant || submitting) return;
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
    setSubmitting(true);
    const order: Order = { id: `MJ-${crypto.randomUUID().slice(0, 6).toUpperCase()}`, restaurant: cartRestaurant.name, total, count, city, date: new Date().toISOString(), items: cart.map(l => `${l.quantity} × ${l.name}${l.option ? ` (${l.option})` : ""}`) };
    const next = [order, ...orders].slice(0, 10);
    setCurrentOrder(order); setOrders(next);
    try { localStorage.setItem("manjeo-orders-v1", JSON.stringify(next)); } catch {}
    setCart([]); setSubmitting(false); setView("success");
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
      if (cart.length && cart[0].restaurantId !== rest.id) throw new Error("The basket contains another restaurant. Clear it in the interface first.");
      const option = item.large ? "Classique · Sans piment" : "";
      addLine({ key: `${item.id}-${option}`, restaurantId: rest.id, productId: item.id, name: item.name, price: item.price, quantity: 1, option });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { staged: item.id, realOrderPlaced: false };
    }});
    return () => lifecycle.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);
  function CartPanel() { return <div className="cart-panel">
    <div className="cart-heading"><h2>Votre panier</h2><span className="count-pill">{count}</span></div>
    {!cart.length ? <div className="empty-cart"><div className="bag-illustration"><ShoppingBag size={38} strokeWidth={1.5}/><span><Heart size={13} fill="currentColor"/></span></div><h3>Une petite faim ?</h3><p>Il ne manque que vos envies.<br/>Ajoutez un plat pour commencer.</p><span className="empty-line"/></div> : <>
      <button className="cart-restaurant" onClick={() => { if (cartRestaurant) openRestaurant(cartRestaurant); setCartOpen(false); }}><Utensils size={15}/>{cartRestaurant?.name}<ArrowRight size={15}/></button>
      <div className="cart-lines">{cart.map(line => <div className="cart-line" key={line.key}><div className="line-title"><strong>{line.name}</strong><b>{money(line.price * line.quantity)}</b></div>{line.option && <p>{line.option}</p>}<div className="line-actions"><div className="stepper small"><button aria-label={`Retirer un ${line.name}`} onClick={() => changeQuantity(line.key, -1)}><Minus size={13}/></button><span>{line.quantity}</span><button disabled={line.quantity >= 20} aria-label={`Ajouter un ${line.name}`} onClick={() => changeQuantity(line.key, 1)}><Plus size={13}/></button></div><button className="remove-line" aria-label={`Supprimer ${line.name}`} onClick={() => setCart(c => c.filter(l => l.key !== line.key))}><Trash2 size={15}/></button></div></div>)}</div>
      <div className="cart-totals"><div><span>Sous-total</span><span>{money(subtotal)}</span></div><div><span>Livraison à {city}</span><span>{money(delivery)}</span></div><div className="total"><strong>Total</strong><strong>{money(total)}</strong></div></div>
      {view !== "checkout" && <Button className="primary-btn cart-checkout" onClick={checkout}>Passer commande <ArrowRight size={17}/></Button>}
    </>}
    <div className="cart-foot"><Bike size={20}/><span>Les bonnes choses arrivent<br/><strong>jusqu’à votre porte.</strong></span></div>
  </div>; }
  return <>
    <header className="site-header"><div className="header-inner"><button className="brand" aria-label="manjéo, accueil" onClick={() => setView("home")}>manjéo<span className="brand-dot">✳</span></button><div className="header-divider"/><button className="location-button" onClick={() => setLocationOpen(true)}><span className="location-icon"><MapPin size={19}/></span><span><small>Livrer à</small><strong>{address || `${city}, centre-ville`}</strong></span><ChevronDown size={15}/></button><nav className="desktop-nav"><button className={view === "home" || view === "restaurant" ? "active" : ""} onClick={() => setView("home")}>Restaurants</button><button onClick={() => setHistoryOpen(true)}>Mes commandes</button></nav><span className="demo-badge">Démo</span><button className="header-cart" aria-label={`Ouvrir le panier, ${count} articles`} onClick={() => setCartOpen(true)}><ShoppingBag size={20}/><span>{count}</span></button></div></header>
    <main className="page-shell">
      {(view === "home" || view === "restaurant") && <div className="delivery-note"><MapPin size={13}/><span>Cayenne · Rémire-Montjoly · Matoury</span><span className="note-separator">/</span><span>Le meilleur du coin, à portée de main</span></div>}
      <div className={`main-layout ${view === "success" ? "single-layout" : ""}`}><div className="main-content">
        {view === "home" && <>
          <div className="welcome-row"><div><div className="eyebrow">BONJOUR, {city.toUpperCase()} <span>☀</span></div><h1>Qu’est-ce qu’on mange ?</h1><p>Vos prochaines bonnes adresses sont juste ici.</p></div><label className="search-box"><Search size={19}/><Input aria-label="Rechercher un restaurant ou un plat" placeholder="Un resto, un plat, une envie…" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button aria-label="Effacer la recherche" onClick={() => setSearch("")}><X size={15}/></button>}</label></div>
          <div className="category-list" aria-label="Types de cuisine">{categories.map(c => <button key={c.name} className={`category ${category === c.name ? "selected" : ""}`} onClick={() => setCategory(c.name)} aria-pressed={category === c.name}><span>{c.emoji}</span>{c.name}</button>)}</div>
          {!search && category === "Tout" && <div className="promo-grid"><button className="local-promo" onClick={() => openRestaurant(restaurants[0])}><img src="/images/chicken.jpg" alt="Poulet grillé et riz parfumé"/><div className="promo-shade"/><div className="promo-copy"><span className="promo-label"><Sparkles size={13}/> LE GOÛT DE CHEZ NOUS</span><h2>Un bon plat.<br/>Et la journée repart.</h2><span className="promo-cta">Découvrir Ti Kaz Kréol <ArrowRight size={16}/></span></div><span className="price-sticker">Dès<strong>11 €</strong></span></button><button className="lunch-promo" onClick={() => setCategory("Créole")}><span className="lunch-label"><Clock3 size={15}/> LA PAUSE QUI FAIT DU BIEN</span><h2>Bien manger.<br/>Même au boulot.</h2><p>Des plats généreux,<br/>livrés à l’heure du déjeuner.</p><span className="lunch-link">Trouver mon déjeuner <ArrowRight size={17}/></span><Utensils className="lunch-icon" size={76} strokeWidth={1.25}/></button></div>}
          <section className="restaurants-section"><div className="section-heading"><div><h2>{search ? "Résultats de recherche" : category === "Tout" ? "Les bonnes adresses" : `Envie de ${category.toLowerCase()} ?`}</h2><p>{filtered.length} restaurant{filtered.length > 1 ? "s" : ""} à découvrir près de vous</p></div><label className="sort-control"><SlidersHorizontal size={15}/><select aria-label="Trier les restaurants" value={sort} onChange={e => setSort(e.target.value)}><option value="recommended">Recommandés</option><option value="fast">Les plus rapides</option><option value="price">Prix croissant</option></select><ChevronDown size={13}/></label></div>
          <div className="restaurant-grid">{filtered.map(r => <button className="restaurant-card" key={r.id} onClick={() => openRestaurant(r)}><div className="restaurant-image"><img src={r.image} alt={r.imageAlt} loading="lazy"/><span className={`restaurant-tag ${r.tag === "Coup de cœur" ? "orange-tag" : ""}`}>{r.tag === "Coup de cœur" && <Heart size={12} fill="currentColor"/>}{r.tag}</span><span className="time-tag"><Clock3 size={12}/>{r.minutes}–{r.minutes + 10} min</span></div><div className="restaurant-info"><div className="restaurant-title"><h3>{r.name}</h3><span className="rating"><Star size={12} fill="currentColor"/>{r.rating.toFixed(1)}</span></div><p>{r.description}</p><div className="restaurant-meta"><span><Bike size={14}/>{money(r.delivery + (city === "Cayenne" ? 0 : 100))}</span><span className="meta-dot">·</span><span>Dès {money(r.from)}</span><span className="card-arrow"><ArrowRight size={16}/></span></div></div></button>)}</div>
          {!filtered.length && <div className="no-results"><Search size={35}/><h3>Aucune adresse pour cette envie</h3><p>Essayez « poulet », « burger » ou une autre cuisine.</p><Button variant="outline" onClick={() => { setSearch(""); setCategory("Tout"); }}>Voir tous les restaurants</Button></div>}</section>
          <div className="local-footer"><span className="local-footer-icon"><Heart size={19}/></span><div><strong>D’ici. Et ça se goûte.</strong><p>Des cuisines du coin, des repas qui rassemblent.</p></div><span>Fait pour la Guyane <span className="flag-dot">●</span></span></div>
        </>}
        {view === "restaurant" && <><button className="back-link" onClick={() => setView("home")}><ArrowLeft size={17}/> Tous les restaurants</button><div className="restaurant-hero"><img src={restaurant.image} alt={restaurant.imageAlt}/><span className="hero-pill">{restaurant.tag}</span></div><div className="restaurant-detail-heading"><span className="eyebrow">{restaurant.category.toUpperCase()} · {city.toUpperCase()}</span><h1>{restaurant.name}</h1><p>{restaurant.description}. Préparé avec soin, à savourer chez vous.</p><div className="restaurant-detail-meta"><span><Star size={15} fill="currentColor"/>{restaurant.rating.toFixed(1)} <small>(avis fictifs)</small></span><span><Clock3 size={16}/>{restaurant.minutes}–{restaurant.minutes + 10} min</span><span><Bike size={17}/> Livraison {money(restaurant.delivery + (city === "Cayenne" ? 0 : 100))}</span></div></div><div className="menu-note"><Flame size={19}/><span>Une cuisine généreuse, une carte courte. Faites-vous plaisir.</span></div>{["Les plats", "Les petits plus"].map(group => <section className="menu-section" key={group}><h2>{group}</h2><div className="products-grid">{restaurant.products.filter(p => p.group === group).map(p => <button className="product-card" key={p.id} onClick={() => showProduct(p)}><div><h3>{p.name}</h3><p>{p.description}</p><strong>{money(p.price)}</strong>{p.popular && <span className="popular-label"><Flame size={12}/> Le favori</span>}</div><div className={`product-photo ${!p.image ? "no-photo" : ""}`}>{p.image ? <img src={p.image} alt={p.name}/> : <Utensils size={28}/>}<span className="add-circle"><Plus size={19}/></span></div></button>)}</div></section>)}<p className="photo-note">Photos d’illustration · restaurants et menus fictifs</p></>}
        {view === "checkout" && cart.length > 0 && <><button className="back-link" onClick={() => { if (cartRestaurant) setSelectedId(cartRestaurant.id); setView("restaurant"); }}><ArrowLeft size={17}/> Continuer mes achats</button><div className="checkout-heading"><span className="eyebrow">PRESQUE À TABLE</span><h1>On vous livre où ?</h1><p>Encore quelques détails et c’est prêt.</p></div><form className="checkout-form" onSubmit={submitOrder}><section><h2><span>1</span> Vos coordonnées</h2><div className="form-grid"><label>Prénom et nom<Input name="name" onInput={e => e.currentTarget.setCustomValidity("")} autoComplete="name" placeholder="Camille Dupont" required minLength={2} maxLength={80}/></label><label>Téléphone<Input name="phone" type="tel" autoComplete="tel" placeholder="0694 00 00 00" required onInput={e => e.currentTarget.setCustomValidity("")}/></label></div></section><section><h2><span>2</span> Adresse de livraison</h2><label>Rue et numéro<Input name="address" onInput={e => e.currentTarget.setCustomValidity("")} autoComplete="street-address" placeholder="12 avenue du Général de Gaulle" value={address} onChange={e => setAddress(e.target.value)} required minLength={5} maxLength={180}/></label><div className="form-grid"><label>Commune<select name="city" value={city} onChange={e => setCity(e.target.value)}>{cities.map(c => <option key={c}>{c}</option>)}</select></label><label>Bâtiment, étage (facultatif)<Input name="details" placeholder="Bâtiment A, 2e étage" maxLength={120}/></label></div><label>Instructions de livraison (facultatif)<textarea name="notes" placeholder="Un repère pour vous trouver plus facilement…" rows={2} maxLength={300}/></label><div className="delivery-estimate"><Bike size={22}/><div><strong>Livraison estimée dans {cartRestaurant?.minutes}–{(cartRestaurant?.minutes || 25) + 10} min</strong><p>Délai fictif pour tester le parcours.</p></div></div></section><section><h2><span>3</span> Paiement de démonstration</h2><div className="payment-demo"><CreditCard size={23}/><div><strong>Carte de test</strong><p>Aucune carte bancaire requise. Aucun débit.</p></div><Check size={19}/></div></section><div className="checkout-mobile-total"><span>Total, livraison incluse</span><strong>{money(total)}</strong></div><Button className="primary-btn submit-order" type="submit" disabled={submitting}>{submitting ? "Confirmation en cours…" : `Confirmer la commande test · ${money(total)}`}<ArrowRight size={18}/></Button><p className="demo-explanation">Restaurants et produits fictifs. Cette commande ne sera ni transmise ni livrée.</p></form></>}
        {view === "checkout" && !cart.length && <div className="no-results"><ShoppingBag size={35}/><h1>Votre panier est vide</h1><Button className="primary-btn" onClick={() => setView("home")}>Choisir un restaurant</Button></div>}
        {view === "success" && currentOrder && <div className="success-page"><div className="success-icon"><CheckCheck size={43}/></div><span className="eyebrow">ET VOILÀ, C’EST COMMANDÉ !</span><h1>À table, bientôt.</h1><p>Votre commande de démonstration est confirmée.</p><div className="order-ticket"><div><span className="ticket-label">COMMANDE TEST</span><strong>{currentOrder.id}</strong></div><span className="ticket-status"><Check size={13}/> Confirmée</span><h2>{currentOrder.restaurant}</h2>{currentOrder.items.map((item, index) => <p key={index}>{item}</p>)}<div className="ticket-total"><span>{currentOrder.count} article{currentOrder.count > 1 ? "s" : ""} · Livraison à {currentOrder.city}</span><strong>{money(currentOrder.total)}</strong></div></div><div className="success-info"><PackageCheck size={21}/><p>Le parcours s’arrête ici pour la démo.<br/>Aucun paiement, aucune préparation, aucune livraison réelle.</p></div><Button className="primary-btn" onClick={() => setView("home")}>Découvrir d’autres adresses <ArrowRight size={17}/></Button><button className="text-link" onClick={() => setHistoryOpen(true)}>Voir mes commandes test</button></div>}
      </div>{view !== "success" && <aside className="desktop-cart"><CartPanel/><div className="local-promise"><span><Leaf size={16}/></span><p>Tout près de vous.<br/><strong>Et surtout, très bon.</strong></p></div><p className="sidebar-demo">Vous explorez une démo.<br/>Restaurants, avis et tarifs fictifs.</p></aside>}</div>
      <footer className="site-footer"><span className="footer-brand">manjéo<span>✳</span></span><span>La Guyane a bon goût.</span><button onClick={() => setHistoryOpen(true)}>Mes commandes test</button><span>Prototype local · aucune commande réelle</span></footer>
    </main>
    {count > 0 && view !== "checkout" && view !== "success" && <button className="mobile-cart-bar" onClick={() => setCartOpen(true)}><span className="mobile-count">{count}</span><span>Voir mon panier</span><strong>{money(total)}</strong></button>}
    <Sheet open={cartOpen} onOpenChange={setCartOpen}><SheetContent className="cart-sheet"><SheetTitle className="sr-only">Votre panier</SheetTitle><SheetDescription className="sr-only">Articles de votre commande de démonstration.</SheetDescription><CartPanel/></SheetContent></Sheet>
    <Dialog open={locationOpen} onOpenChange={setLocationOpen}><DialogContent className="app-dialog"><DialogTitle>Où avez-vous faim ?</DialogTitle><DialogDescription>Choisissez votre zone de livraison pour cette démo.</DialogDescription><form onSubmit={e => { e.preventDefault(); setLocationOpen(false); }} className="location-form"><label>Commune<select value={city} onChange={e => setCity(e.target.value)}>{cities.map(c => <option key={c}>{c}</option>)}</select></label><label>Adresse (facultatif pour explorer)<Input placeholder="Rue et numéro" value={address} onChange={e => setAddress(e.target.value)} maxLength={180}/></label><p>Livraison majorée de 1 € à Rémire-Montjoly et Matoury dans cette démo.</p><Button type="submit" className="primary-btn">Valider mon adresse <MapPin size={16}/></Button></form></DialogContent></Dialog>
    <Dialog open={!!product} onOpenChange={open => { if (!open) setProduct(null); }}><DialogContent className="app-dialog product-dialog">{product && <>{product.image && <img className="dialog-product-image" src={product.image} alt={product.name}/>}<div className="product-dialog-body"><span className="eyebrow">{restaurant.name}</span><DialogTitle>{product.name}</DialogTitle><DialogDescription>{product.description}</DialogDescription>{product.large && <><fieldset><legend>Votre appétit</legend><div className="portion-options">{["Classique", "Gros appétit"].map(p => <label key={p} className={portion === p ? "chosen" : ""}><input type="radio" name="portion" checked={portion === p} onChange={() => setPortion(p)}/><span>{p}<small>{p === "Classique" ? "La bonne portion" : "Un peu plus de bonheur"}</small></span><b>{p === "Classique" ? "Inclus" : "+ 2 €"}</b></label>)}</div></fieldset><fieldset><legend>Un peu de piment ?</legend><div className="spice-options">{["Sans piment", "Piment à part", "Bien relevé"].map(s => <button className={sauce === s ? "chosen" : ""} key={s} onClick={() => setSauce(s)} aria-pressed={sauce === s}>{s}</button>)}</div></fieldset></>}<div className="add-product-row"><div className="stepper"><button disabled={quantity <= 1} aria-label="Diminuer la quantité" onClick={() => setQuantity(q => Math.max(1, q - 1))}><Minus size={17}/></button><span aria-live="polite">{quantity}</span><button disabled={quantity >= 20} aria-label="Augmenter la quantité" onClick={() => setQuantity(q => Math.min(20, q + 1))}><Plus size={17}/></button></div><Button className="primary-btn" onClick={addProduct}>Ajouter · {money((product.price + (product.large && portion === "Gros appétit" ? 200 : 0)) * quantity)}<Plus size={17}/></Button></div></div></>}</DialogContent></Dialog>
    <Dialog open={!!pending} onOpenChange={open => { if (!open) setPending(null); }}><DialogContent className="app-dialog"><DialogTitle>Une nouvelle bonne adresse ?</DialogTitle><DialogDescription>Une commande se fait auprès d’un seul restaurant. Ajouter ce plat remplacera votre panier de {cartRestaurant?.name}.</DialogDescription><Button className="primary-btn" onClick={() => { if (pending) addLine(pending, true); setPending(null); }}>Remplacer le panier</Button><Button variant="outline" onClick={() => setPending(null)}>Garder mon panier actuel</Button></DialogContent></Dialog>
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent className="app-dialog history-dialog"><DialogTitle>Mes commandes test</DialogTitle><DialogDescription>Vos 10 dernières commandes, enregistrées sur cet appareil.</DialogDescription>{orders.length ? <div className="order-history">{orders.map(order => <div className="history-order" key={order.id}><span className="history-icon"><ShoppingBag size={21}/></span><div><strong>{order.restaurant}</strong><p>{order.id} · {new Date(order.date).toLocaleDateString("fr-FR")}</p><span>{order.count} article{order.count > 1 ? "s" : ""} · Commande fictive</span><details><summary>Voir les articles</summary>{order.items.map((item, index) => <p key={index}>{item}</p>)}</details></div><b>{money(order.total)}</b></div>)}</div> : <div className="no-orders"><ShoppingBag size={36}/><h3>Votre première envie vous attend.</h3><p>Vos commandes test apparaîtront ici.</p><Button className="primary-btn" onClick={() => { setHistoryOpen(false); setView("home"); }}>Explorer les restaurants</Button></div>}</DialogContent></Dialog>
    <div className={`toast ${notice ? "visible" : ""}`} role="status" aria-live="polite">{notice && <><span><Check size={15}/></span>{notice}</>}</div>
  </>;
}
