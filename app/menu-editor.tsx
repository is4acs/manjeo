import { useEffect, useRef, useState } from "react";
import { Archive, ArrowDown, ArrowUp, CheckCircle2, ImagePlus, Pencil, Plus, RefreshCw, Save, Trash2, Undo2, UtensilsCrossed } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { money, type Product, type OptionGroup, type OptionChoice, type Restaurant } from "@/lib/menu";
import { t } from "@/lib/i18n";
import "./menu-editor.css";
type MenuError = string | {source: string; params: Record<string, string | number>};
const errorText = (error: MenuError) => typeof error === "string" ? t(error) : t(error.source, error.params);

type RestaurantMenu = { version: number; categories: string[]; products: Product[] };
const profileFields = ["name", "description", "minutes", "pickupAddress", "pickupCity"] as const;
type RestaurantProfile = Pick<Restaurant, typeof profileFields[number]>;
const restaurantProfile = (restaurant: Restaurant): RestaurantProfile => Object.fromEntries(profileFields.map(field => [field, restaurant[field]])) as RestaurantProfile;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const newId = () => crypto.randomUUID();
const cities = ["Cayenne", "Matoury", "Rémire-Montjoly"];
const priceInput = (value: number) => (value / 100).toFixed(2);
const validImage = (value: string) => !value || /^https:\/\//.test(value) || /^\/(?:images|api\/images)\/[a-zA-Z0-9/_.,%-]+$/.test(value);

function PriceField({ label, value, onChange, minimum = 0 }: { label: string; value: number; onChange: (value: number) => void; minimum?: number }) {
  const [text, setText] = useState(priceInput(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(priceInput(value)); }, [value]);
  return <label className="menu-field">{label}<input inputMode="decimal" type="number" min={minimum / 100} max="1000" step="0.01" required value={text} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; if (text !== "" && Number.isFinite(Number(text))) setText(priceInput(value)); }} onChange={event => { setText(event.target.value); const next = Number(event.target.value.replace(",", ".")); onChange(event.target.value === "" || !Number.isFinite(next) ? -1 : Math.round(next * 100)); }} /></label>;
}

function validateMenu(menu: RestaurantMenu): MenuError {
  const categories = menu.categories.map(category => category.trim());
  if (!categories.length) return "Ajoutez au moins une catégorie à votre carte.";
  if (categories.some(category => !category || category.length > 80)) return "Chaque catégorie doit contenir entre 1 et 80 caractères.";
  if (new Set(categories.map(category => category.toLocaleLowerCase())).size !== categories.length) return "Deux catégories portent le même nom. Renommez l’une d’elles.";
  for (const product of menu.products) {
    if (!product.name.trim()) return "Donnez un nom à chaque produit avant de publier.";
    if (!product.archived && !categories.includes(product.group.trim())) return {source: "Choisissez une catégorie pour « {name} ».", params: {name: product.name}};
    if (!Number.isInteger(product.price) || product.price < 1 || product.price > 100000) return {source: "Le prix de « {name} » doit être compris entre 0,01 € et 1 000 €.", params: {name: product.name}};
    if (!validImage(product.image ?? "")) return {source: "Utilisez une URL HTTPS ou importez une photo pour « {name} ».", params: {name: product.name}};
    for (const group of product.optionGroups) {
      if (!group.name.trim() || !group.choices.length) return {source: "Nommez chaque groupe d’options de « {name} » et ajoutez au moins un choix.", params: {name: product.name}};
      if (!Number.isInteger(group.min) || !Number.isInteger(group.max) || group.min < 0 || group.max < 1 || group.min > group.max || group.max > group.choices.length) return {source: "Vérifiez les limites de choix pour « {name} » : minimum ≤ maximum ≤ nombre de choix.", params: {name: group.name}};
      for (const choice of group.choices) if (!choice.name.trim() || !Number.isInteger(choice.price) || choice.price < 0 || choice.price > 100000) return {source: "Chaque choix de « {name} » doit avoir un nom et un supplément entre 0 € et 1 000 €.", params: {name: group.name}};
    }
  }
  return "";
}

export default function MenuEditor({ restaurant, onRestaurantChange }: { restaurant: Restaurant; onRestaurantChange: (restaurant: Restaurant, fields: (keyof RestaurantProfile)[]) => void }) {
  const [draft, setDraft] = useState<RestaurantMenu | null>(null);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState<MenuError>("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [discardArmed, setDiscardArmed] = useState(false);
  const [profile, setProfile] = useState(() => restaurantProfile(restaurant));
  const profileBaseline = useRef(profile);
  const [profileBusy, setProfileBusy] = useState(false);
  const active = useRef(true);
  const savingRef = useRef(false);
  const uploadingRef = useRef(false);
  const profileSavingRef = useRef(false);
  const request = useRef(0);
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty || profileFields.some(field => profile[field] !== profileBaseline.current[field]);
  const key = `manjeo-menu-draft-${restaurant.id}`;

  useEffect(() => {
    const previous = profileBaseline.current;
    const latest = restaurantProfile(restaurant);
    // Polling may update shared details; preserve only fields the author edited.
    setProfile(current => Object.fromEntries(profileFields.map(field => [field, current[field] === previous[field] ? latest[field] : current[field]])) as RestaurantProfile);
    profileBaseline.current = latest;
  }, [restaurant.name, restaurant.description, restaurant.minutes, restaurant.pickupAddress, restaurant.pickupCity]);

  async function load(restore = false) {
    if (savingRef.current || uploadingRef.current) return;
    const sequence = ++request.current;
    setLoading(true); setError("");
    try {
      const { menu } = await api<{ menu: RestaurantMenu }>(`/api/restaurants/${encodeURIComponent(restaurant.id)}/menu`);
      if (!active.current || sequence !== request.current) return;
      setBaseline(JSON.stringify(menu)); setDraft(copy(menu)); setConflict(false); setDiscardArmed(false);
      if (restore) {
        try {
          const stored = sessionStorage.getItem(key);
          if (stored) {
            const previous = JSON.parse(stored) as { draft: RestaurantMenu; baseline: string };
            if (previous.draft && Array.isArray(previous.draft.products) && Array.isArray(previous.draft.categories) && typeof previous.baseline === "string") {
              setDraft(previous.draft); setBaseline(previous.baseline); setConflict(previous.draft.version !== menu.version);
              setNotice("Votre brouillon non publié a été retrouvé dans cet onglet.");
            }
          }
        } catch { /* A malformed or unavailable browser draft never blocks the server menu. */ }
      } else { try { sessionStorage.removeItem(key); } catch {} }
    } catch (cause) { if (active.current && sequence === request.current) setError(cause instanceof Error ? cause.message : "Impossible de charger la carte."); }
    finally { if (active.current && sequence === request.current) setLoading(false); }
  }
  useEffect(() => { active.current = true; void load(true); return () => { active.current = false; ++request.current; }; }, [restaurant.id]);
  useEffect(() => { if (!draft || loading) return; try { if (dirty) sessionStorage.setItem(key, JSON.stringify({ draft, baseline })); else sessionStorage.removeItem(key); } catch {} }, [draft, dirty, baseline, key, loading]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  function updateProduct(id: string, fields: Partial<Product>) {
    setNotice(""); setDiscardArmed(false);
    setDraft(current => current ? { ...current, products: current.products.map(product => product.id === id ? { ...product, ...fields } : product) } : current);
  }
  function updateGroup(product: Product, groupId: string, fields: Partial<OptionGroup>) { updateProduct(product.id, { optionGroups: product.optionGroups.map(group => group.id === groupId ? { ...group, ...fields } : group) }); }
  function updateChoice(product: Product, group: OptionGroup, choiceId: string, fields: Partial<OptionChoice>) { updateGroup(product, group.id, { choices: group.choices.map(choice => choice.id === choiceId ? { ...choice, ...fields } : choice) }); }
  function renameCategory(index: number, name: string) {
    if (draft?.categories.some((category, position) => position !== index && category.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())) { setError("Ce nom de catégorie est déjà utilisé. Choisissez un autre nom."); return; }
    setDraft(current => { if (!current) return current; const previous = current.categories[index]; return { ...current, categories: current.categories.map((category, position) => position === index ? name : category), products: current.products.map(product => product.group === previous ? { ...product, group: name } : product) }; });
  }
  function moveCategory(index: number, offset: number) {
    setDraft(current => { if (!current) return current; const categories = [...current.categories]; [categories[index], categories[index + offset]] = [categories[index + offset], categories[index]]; return { ...current, categories }; });
  }
  function moveProduct(id: string, offset: number) {
    setDraft(current => { if (!current) return current; const products = [...current.products]; const index = products.findIndex(product => product.id === id); if (index < 0 || index + offset < 0 || index + offset >= products.length) return current; [products[index], products[index + offset]] = [products[index + offset], products[index]]; return { ...current, products }; });
  }
  function addProduct() {
    if (!draft || draft.products.length >= 100) return;
    const id = newId(); setDraft({ ...draft, products: [...draft.products, { id, name: "Nouveau produit", description: "", price: 100, group: draft.categories[0] || "À la carte", image: "", available: true, archived: false, allergens: "", version: 1, optionGroups: [] }] }); setExpanded(id);
  }
  async function publish(event: React.FormEvent) {
    event.preventDefault(); if (!draft || savingRef.current || uploadingRef.current) return;
    const cleaned = { ...draft, categories: draft.categories.map(category => category.trim()), products: draft.products.map(product => ({ ...product, name: product.name.trim(), group: product.group.trim(), image: product.image?.trim() || "" })) };
    const message = validateMenu(cleaned); if (message) { setError(message); return; }
    savingRef.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const { menu } = await api<{ menu: RestaurantMenu }>(`/api/restaurants/${encodeURIComponent(restaurant.id)}/menu`, { method: "PATCH", body: JSON.stringify(cleaned) });
      if (!active.current) return;
      setDraft(copy(menu)); setBaseline(JSON.stringify(menu)); setConflict(false); setDiscardArmed(false); setNotice("Carte publiée. Les clients voient maintenant vos modifications.");
    } catch (cause) { if (active.current) { setError(cause instanceof Error ? cause.message : "La publication a échoué."); if (cause instanceof ApiError && cause.status === 409) setConflict(true); } }
    finally { savingRef.current = false; if (active.current) setSaving(false); }
  }
  async function upload(productId: string, file: File | undefined) {
    if (!file || uploadingRef.current || savingRef.current) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 1024 * 1024) { setError("Choisissez une image JPEG, PNG ou WebP de 1 Mo maximum."); return; }
    uploadingRef.current = true; setUploading(productId); setError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("La photo n’a pas pu être lue.")); reader.readAsDataURL(file); });
      if (!active.current) return;
      const data = await api<{ url: string }>(`/api/restaurants/${encodeURIComponent(restaurant.id)}/images`, { method: "POST", body: JSON.stringify({ dataUrl }) });
      if (active.current) updateProduct(productId, { image: data.url });
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "L’import a échoué."); }
    finally { uploadingRef.current = false; if (active.current) setUploading(""); }
  }
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault(); if (profileSavingRef.current) return;
    const fields = profileFields.filter(field => profile[field] !== profileBaseline.current[field]);
    if (!fields.length) { setNotice("Informations du restaurant enregistrées."); return; }
    const changes = Object.fromEntries(fields.map(field => [field, profile[field]]));
    profileSavingRef.current = true; setProfileBusy(true); setError("");
    try {
      const data = await api<{ restaurant: Restaurant }>(`/api/restaurants/${encodeURIComponent(restaurant.id)}`, { method: "PATCH", body: JSON.stringify(changes) });
      if (active.current) {
        const saved = Object.fromEntries(fields.map(field => [field, data.restaurant[field]]));
        profileBaseline.current = { ...profileBaseline.current, ...saved };
        setProfile(current => ({ ...current, ...saved }));
        onRestaurantChange(data.restaurant, fields);
        setNotice("Informations du restaurant enregistrées.");
      }
    }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "La modification a échoué."); }
    finally { profileSavingRef.current = false; if (active.current) setProfileBusy(false); }
  }

  if (loading) return <div className="staff-loading" role="status"><RefreshCw size={24} className="staff-spinning" /><p>{t("Chargement de votre carte…")}</p></div>;
  if (!draft) return <div className="staff-alert" role="alert"><span>{errorText(error || "La carte est indisponible.")}</span><button type="button" onClick={() => void load(true)}>{t("Réessayer")}</button></div>;
  const visible = draft.products.filter(product => showArchived || !product.archived);
  return <div className="menu-editor">
    <div className="staff-section-heading"><div><h2>{t("Votre carte, à votre façon")}</h2><p>{t("Produits, catégories, photos et personnalisations : publiez quand tout est prêt.")}</p></div></div>
    {error && <div className="staff-alert" role="alert"><span>{errorText(error)}</span><button type="button" onClick={() => setError("")}>{t("Fermer")}</button></div>}
    {notice && <p className="menu-saved" role="status"><CheckCircle2 size={17} />{t(notice)}</p>}
    {conflict && <div className="menu-conflict" role="alert"><strong>{t("La carte a changé depuis l’ouverture de votre brouillon.")}</strong><p>{t("Vos modifications restent dans cet onglet. Copiez les éléments à conserver avant de charger la carte publiée ; aucun écrasement automatique n’est effectué.")}</p><button className="staff-button" type="button" disabled={saving || !!uploading} onClick={() => setDiscardArmed(true)}>{t("Charger la carte publiée")}</button></div>}
    {discardArmed && <div className="menu-conflict" role="alert"><strong>{t("Remplacer le brouillon par la carte publiée ?")}</strong><p>{t("Les modifications non publiées de cet onglet seront supprimées.")}</p><div className="menu-toolbar-actions"><button className="staff-button" type="button" onClick={() => setDiscardArmed(false)}>{t("Garder mon brouillon")}</button><button className="staff-button menu-danger" type="button" disabled={saving || !!uploading} onClick={() => void load()}>{t("Abandonner et recharger")}</button></div></div>}
    <form onSubmit={publish}>
      <div className="menu-toolbar"><div><strong className={dirty ? "menu-dirty" : ""}>{dirty ? t("Modifications non publiées") : t("Votre carte est publiée")}</strong><p>{t("{count} produits · version {version}", {count: draft.products.filter(product => !product.archived).length, version: draft.version})}{dirty && <> · {t("brouillon conservé dans cet onglet")}</>}</p></div><div className="menu-toolbar-actions"><button type="button" className="staff-button" disabled={saving || !!uploading} onClick={() => dirty ? setDiscardArmed(true) : void load()}><RefreshCw size={15} />{t("Recharger")}</button><button type="submit" className="staff-button staff-button-primary" disabled={!dirty || saving || !!uploading || conflict}><Save size={16} />{saving ? t("Publication…") : t("Publier la carte")}</button></div></div>
      <fieldset disabled={saving || !!uploading} className="menu-editor">
        <section className="menu-panel"><h3>{t("Les catégories")}</h3><p>{t("L’ordre ci-dessous est celui de la vitrine. Renommer une catégorie déplace aussi ses produits.")}</p><div className="menu-categories">{draft.categories.map((category, index) => <div className="menu-category-row" key={index}><input aria-label={t("Nom de la catégorie {name}", {name: index + 1})} value={category} maxLength={80} required onChange={event => renameCategory(index, event.target.value)} /><button type="button" className="menu-icon-button" aria-label={t("Monter la catégorie {name}", {name: category})} disabled={index === 0} onClick={() => moveCategory(index, -1)}><ArrowUp size={16} /></button><button type="button" className="menu-icon-button" aria-label={t("Descendre la catégorie {name}", {name: category})} disabled={index === draft.categories.length - 1} onClick={() => moveCategory(index, 1)}><ArrowDown size={16} /></button><button type="button" className="menu-icon-button" aria-label={t("Supprimer la catégorie vide {name}", {name: category})} title={t("Une catégorie doit être vide pour être supprimée.")} disabled={draft.categories.length === 1 || draft.products.some(product => !product.archived && product.group === category)} onClick={() => setDraft({ ...draft, categories: draft.categories.filter((_, position) => index !== position) })}><Trash2 size={15} /></button></div>)}</div><div className="menu-new-category"><input aria-label={t("Nouvelle catégorie")} value={categoryName} maxLength={80} placeholder={t("Ex. Desserts maison")} onChange={event => setCategoryName(event.target.value)} /><button type="button" className="staff-button" disabled={!categoryName.trim() || draft.categories.length >= 30 || draft.categories.some(category => category.toLocaleLowerCase() === categoryName.trim().toLocaleLowerCase())} onClick={() => { setDraft({ ...draft, categories: [...draft.categories, categoryName.trim()] }); setCategoryName(""); }}><Plus size={15} />{t("Ajouter une catégorie")}</button></div></section>
        <section><div className="menu-section-title"><div><h3>{t("Les produits")}</h3><p>{t("Les produits archivés restent dans l’historique des commandes.")}</p></div><button type="button" className="staff-button" disabled={draft.products.length >= 100 || !draft.categories.length} onClick={addProduct}><Plus size={16} />{t("Ajouter un produit")}</button></div><label className="menu-check" style={{ marginTop: 16 }}><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />{t("Afficher les produits archivés ({count})", {count: draft.products.filter(product => product.archived).length})}</label><div className="menu-products">
          {visible.map(product => <article className="menu-product-editor" key={product.id}><div className="menu-product-heading">{product.image && validImage(product.image) ? <img src={product.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="menu-product-picture"><UtensilsCrossed size={25} /></span>}<div><h4>{product.name || t("Produit sans nom")}</h4><p>{product.group} · {money(Math.max(0, product.price))}</p><small className={product.archived ? "menu-archived" : ""}>{product.archived ? t("Archivé") : product.available ? t("Disponible") : t("Indisponible")}</small>{product.optionGroups.length > 0 && <small>{t(product.optionGroups.length > 1 ? "{count} groupes d’options" : "{count} groupe d’options", {count: product.optionGroups.length})}</small>}</div><button type="button" className="staff-button" aria-expanded={expanded === product.id} onClick={() => setExpanded(expanded === product.id ? null : product.id)}><Pencil size={14} />{expanded === product.id ? t("Réduire") : t("Modifier")}</button></div>
          {expanded === product.id && <div className="menu-product-form"><div className="menu-form-grid"><label className="menu-field">{t("Nom du produit")}<input required value={product.name} maxLength={120} onChange={event => updateProduct(product.id, { name: event.target.value })} /></label><PriceField label={t("Prix du produit (€)")} value={product.price} minimum={1} onChange={price => updateProduct(product.id, { price })} /><label className="menu-field">{t("Catégorie")}<select value={product.group} onChange={event => updateProduct(product.id, { group: event.target.value })}>{draft.categories.map(category => <option key={category} value={category}>{category}</option>)}</select></label><label className="menu-field">{t("Allergènes")}<input value={product.allergens} maxLength={500} placeholder={t("Ex. gluten, lait, arachides")} onChange={event => updateProduct(product.id, { allergens: event.target.value })} /></label><label className="menu-field menu-field-wide">{t("Description")}<textarea value={product.description} maxLength={1000} onChange={event => updateProduct(product.id, { description: event.target.value })} /></label><label className="menu-field menu-field-wide">{t("Photo : adresse HTTPS")}<input value={product.image ?? ""} maxLength={2000} placeholder="https://…" onChange={event => updateProduct(product.id, { image: event.target.value })} /><small>{t("Une photo importée peut également être utilisée. Les photos déjà présentes restent disponibles.")}</small></label><label className="menu-field menu-field-wide"><span><ImagePlus size={14} />{t("Ou importer une photo")}</span><input type="file" accept="image/jpeg,image/png,image/webp" aria-label={t("Importer une photo pour {name}", {name: product.name})} onChange={event => { void upload(product.id, event.target.files?.[0]); event.target.value = ""; }} /><small>{uploading === product.id ? t("Import en cours…") : t("JPEG, PNG ou WebP · 1 Mo maximum · publiez ensuite la carte.")}</small></label></div><div className="menu-checks"><label className="menu-check"><input type="checkbox" checked={product.available} onChange={event => updateProduct(product.id, { available: event.target.checked })} />{t("Disponible à la commande")}</label><label className="menu-check"><input type="checkbox" checked={!!product.popular} onChange={event => updateProduct(product.id, { popular: event.target.checked })} />{t("Mettre en avant")}</label></div>
            <div className="menu-section-title"><h3>{t("Personnalisation du produit")}</h3><button type="button" className="staff-button" disabled={product.optionGroups.length >= 8} onClick={() => updateProduct(product.id, { optionGroups: [...product.optionGroups, { id: newId(), name: "Nouvelle option", min: 0, max: 1, choices: [{ id: newId(), name: "Premier choix", price: 0 }] }] })}><Plus size={14} />{t("Ajouter un groupe")}</button></div><p className="menu-note">{t("Exemple : « Accompagnement », minimum 1, maximum 1, puis les choix « Riz » ou « Frites ». Minimum 0 rend le groupe facultatif.")}</p><div className="menu-option-groups">{product.optionGroups.map(group => <div className="menu-option-group" key={group.id}><div className="menu-option-group-title"><strong>{group.name || t("Groupe d’options")}</strong><button type="button" className="menu-icon-button" aria-label={t("Retirer le groupe {name}", {name: group.name})} onClick={() => updateProduct(product.id, { optionGroups: product.optionGroups.filter(item => item.id !== group.id) })}><Trash2 size={15} /></button></div><div className="menu-form-grid"><label className="menu-field menu-field-wide">{t("Nom du groupe")}<input value={group.name} required maxLength={100} onChange={event => updateGroup(product, group.id, { name: event.target.value })} /></label><label className="menu-field">{t("Minimum de choix")}<input type="number" min={0} max={group.choices.length} step={1} required value={group.min} onChange={event => updateGroup(product, group.id, { min: Number(event.target.value) })} /></label><label className="menu-field">{t("Maximum de choix")}<input type="number" min={1} max={Math.max(1, group.choices.length)} step={1} required value={group.max} onChange={event => updateGroup(product, group.id, { max: Number(event.target.value) })} /></label></div><div className="menu-option-choices">{group.choices.map(choice => <div className="menu-option-choice" key={choice.id}><label className="menu-field">{t("Choix")}<input value={choice.name} required maxLength={100} onChange={event => updateChoice(product, group, choice.id, { name: event.target.value })} /></label><PriceField label={t("Supplément (€)")} value={choice.price} onChange={price => updateChoice(product, group, choice.id, { price })} /><button type="button" className="menu-icon-button" aria-label={t("Retirer le choix {name}", {name: choice.name})} disabled={group.choices.length <= 1} onClick={() => { const choices = group.choices.filter(item => item.id !== choice.id); updateGroup(product, group.id, { choices, min: Math.min(group.min, choices.length), max: Math.min(group.max, choices.length) }); }}><Trash2 size={15} /></button></div>)}</div><button type="button" className="staff-button" disabled={group.choices.length >= 20} onClick={() => updateGroup(product, group.id, { choices: [...group.choices, { id: newId(), name: "Nouveau choix", price: 0 }] })}><Plus size={14} />{t("Ajouter un choix")}</button></div>)}</div>
            <div className="menu-product-actions"><div className="menu-toolbar-actions"><button type="button" className="menu-icon-button" aria-label={t("Monter le produit {name}", {name: product.name})} disabled={draft.products[0]?.id === product.id} onClick={() => moveProduct(product.id, -1)}><ArrowUp size={16} /></button><button type="button" className="menu-icon-button" aria-label={t("Descendre le produit {name}", {name: product.name})} disabled={draft.products[draft.products.length - 1]?.id === product.id} onClick={() => moveProduct(product.id, 1)}><ArrowDown size={16} /></button></div><button type="button" className={`staff-button ${product.archived ? "" : "menu-danger"}`} onClick={() => { updateProduct(product.id, { archived: !product.archived, ...(product.archived && !draft.categories.includes(product.group) ? { group: draft.categories[0] } : {}) }); if (!product.archived) setShowArchived(true); }}>{product.archived ? <Undo2 size={15} /> : <Archive size={15} />}{product.archived ? t("Restaurer ce produit") : t("Archiver ce produit")}</button><small className="menu-note">{t("Les changements prennent effet à la publication.")}</small></div>
          </div>}</article>)}
          {!visible.length && <p className="menu-empty-group">{t("Aucun produit à afficher. Ajoutez votre premier produit ou affichez les archives.")}</p>}
        </div></section>
      </fieldset>
    </form>
    <section className="menu-panel"><h3>{t("Votre restaurant et le retrait des commandes")}</h3><p>{t("Ces informations sont enregistrées séparément de votre carte. Utilisez des coordonnées fictives pour cette démonstration.")}</p><form onSubmit={saveProfile}><fieldset disabled={profileBusy} className="menu-editor"><div className="menu-form-grid"><label className="menu-field">{t("Nom du restaurant")}<input required value={profile.name} maxLength={120} onChange={event => setProfile({ ...profile, name: event.target.value })} /></label><label className="menu-field">{t("Temps de préparation estimé (minutes)")}<input required type="number" min={5} max={180} step={1} value={profile.minutes} onChange={event => setProfile({ ...profile, minutes: Number(event.target.value) })} /></label><label className="menu-field menu-field-wide">{t("Présentation")}<textarea value={profile.description} maxLength={500} onChange={event => setProfile({ ...profile, description: event.target.value })} /></label><label className="menu-field">{t("Adresse de retrait")}<input required value={profile.pickupAddress} minLength={5} maxLength={250} onChange={event => setProfile({ ...profile, pickupAddress: event.target.value })} /></label><label className="menu-field">{t("Commune de retrait")}<select value={profile.pickupCity} onChange={event => setProfile({ ...profile, pickupCity: event.target.value })}>{cities.map(city => <option key={city}>{city}</option>)}</select></label></div><div><button type="submit" className="staff-button" disabled={profileBusy}><Save size={15} />{profileBusy ? t("Enregistrement…") : t("Enregistrer les informations")}</button></div></fieldset></form></section>
  </div>;
}
