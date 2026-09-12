"use client";
import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { ArrowRight, Download, LifeBuoy, MapPin, ShoppingBag, Store, Tag } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api, type PublicPromotion, type Role } from "@/lib/api";

type Panel = "" | "help" | "about" | "cities" | "promotions" | "install" | "grocery";
type InstallPrompt = Event & { prompt: () => Promise<void> };

// Chaque entrée mène à une destination réelle de l'application. Ce qui n'existe pas
// encore dans cette démonstration est annoncé comme tel, jamais maquillé en lien mort.
export default function SiteFooter({city, cities, onCity, onAccount, onOrders, onNearby, onStaff, disabled = false}: {
  city: string; cities: string[]; onCity: (city: string) => void;
  onAccount: (role?: Role) => void; onOrders: () => void; onNearby: () => void; onStaff: (role?: Role) => void; disabled?: boolean;
}) {
  const [panel, setPanel] = useState<Panel>("");
  const [promotions, setPromotions] = useState<PublicPromotion[]>([]);
  const [promotionsError, setPromotionsError] = useState("");
  const [promotionsLoading, setPromotionsLoading] = useState(true);
  const [promotionsAttempt, setPromotionsAttempt] = useState(0);
  const [installer, setInstaller] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstaller(event as InstallPrompt); };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);
  useEffect(() => {
    if (panel !== "promotions") return;
    const controller = new AbortController();
    setPromotionsLoading(true); setPromotionsError(""); setPromotions([]);
    void api<{promotions: PublicPromotion[]}>("/api/promotions", {signal: controller.signal})
      .then(data => { if (!controller.signal.aborted) setPromotions(data.promotions); })
      .catch(error => { if (!controller.signal.aborted) setPromotionsError((error as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setPromotionsLoading(false); });
    return () => controller.abort();
  }, [panel, promotionsAttempt]);

  async function install() {
    if (!installer) { setPanel("install"); return; }
    try { await installer.prompt(); } catch { setPanel("install"); } finally { setInstaller(null); }
  }

  const columns: {title: string; links: {label: string; action: () => void; note?: string}[]}[] = [
    {title: "Commander", links: [
      {label: "Restaurants à proximité", action: onNearby},
      {label: "Afficher toutes les villes", action: () => setPanel("cities")},
      {label: "Zone de livraison", action: () => setPanel("cities")},
      {label: "Promotions", action: () => setPanel("promotions")},
      {label: "Mes commandes", action: onOrders},
    ]},
    {title: "Partenaires", links: [
      {label: "Espace restaurant", action: () => onStaff("restaurant")},
      {label: "Espace livreur", action: () => onStaff("courier")},
      {label: "Comptes de démonstration", action: () => onAccount()},
      {label: "Courses à récupérer", action: () => onStaff("courier")},
    ]},
    {title: "En savoir plus", links: [
      {label: "Obtenir de l’aide", action: () => setPanel("help")},
      {label: "Informations sur l’entreprise", action: () => setPanel("about")},
      {label: "À propos de manjéo", action: () => setPanel("about")},
      {label: "Faites vos courses", action: () => setPanel("grocery"), note: "bientôt"},
    ]},
  ];

  return <>
    <footer className="site-footer">
      <div className="footer-columns">
        <div className="footer-brand-column">
          <span className="footer-brand">manjéo</span>
          <p>{t("La Guyane a bon goût. Vos restos de Cayenne, Rémire-Montjoly et Matoury, livrés chaud.")}</p>
          <button className="footer-install" onClick={() => void install()}><Download size={17}/><span><strong>{t("Installer l’application")}</strong><small>{installer ? t("Ajouter manjéo à votre écran d’accueil") : t("Application web · pas encore sur Google Play")}</small></span></button>
        </div>
        {columns.map(column => <nav key={column.title} aria-label={t(column.title)}>
          <h2>{t(column.title)}</h2>
          <ul>{column.links.map(link => <li key={link.label}>
            <button onClick={link.action}>{t(link.label)}{link.note && <span className="footer-note">{t(link.note)}</span>}</button>
          </li>)}</ul>
        </nav>)}
      </div>
      <div className="footer-legal">
        <span>{t("© 2026 manjéo · Guyane française")}</span>
        <span>{t("Démonstration en ligne · restaurants, prix et livraisons fictifs")}</span>
        <a href="https://github.com/is4acs/manjeo" target="_blank" rel="noreferrer noopener">{t("Le code du projet")}</a>
      </div>
    </footer>

    <Dialog open={panel === "help"} onOpenChange={open => !open && setPanel("")}><DialogContent className="app-dialog">
      <div className="dialog-symbol"><LifeBuoy size={24}/></div>
      <DialogTitle>{t("Obtenir de l’aide")}</DialogTitle>
      <DialogDescription>{t("Cette démonstration est partagée : personne ne cuisine, ne roule ni n’encaisse réellement.")}</DialogDescription>
      <ul className="dialog-list">
        <li><strong>{t("Passer une commande")}</strong><span>{t("Connectez-vous avec {email}, ajoutez un plat, puis confirmez. Le mot de passe commun est {password}.", {email: "client@manjeo.test", password: "ManjeoDemo2026!"})}</span></li>
        <li><strong>{t("Suivre les quatre espaces")}</strong><span>{t("Le restaurant accepte et prépare, le livreur prend la course puis demande votre code à quatre chiffres, l’administration supervise.")}</span></li>
        <li><strong>{t("Une commande a disparu")}</strong><span>{t("Sans réponse du restaurant dans les dix minutes, elle s’annule d’elle-même et le code promo éventuel vous est rendu.")}</span></li>
        <li><strong>{t("Un problème technique")}</strong><span>{t("Ouvrez un ticket sur le dépôt du projet ; aucun support téléphonique n’existe pour cette démonstration.")}</span></li>
      </ul>
    </DialogContent></Dialog>

    <Dialog open={panel === "about"} onOpenChange={open => !open && setPanel("")}><DialogContent className="app-dialog">
      <div className="dialog-symbol"><Store size={24}/></div>
      <DialogTitle>{t("Informations sur manjéo")}</DialogTitle>
      <DialogDescription>{t("Un service de livraison de repas imaginé pour Cayenne, réalisé comme démonstration technique.")}</DialogDescription>
      <ul className="dialog-list">
        <li><strong>{t("Ce qui est réel")}</strong><span>{t("Le parcours complet : carte modifiable, panier vérifié côté serveur, commandes, affectation des livreurs, code de remise, historique.")}</span></li>
        <li><strong>{t("Ce qui est fictif")}</strong><span>{t("Les six restaurants, leurs cartes, leurs avis, les prix, les délais, les livreurs et tout paiement. Les photographies sont illustratives.")}</span></li>
        <li><strong>{t("Zone desservie")}</strong><span>{t("Cayenne, Rémire-Montjoly et Matoury, en Guyane française. Aucun autre pays n’est ouvert.")}</span></li>
        <li><strong>{t("Technique")}</strong><span>{t("Interface React et Vite, API Python, base PostgreSQL. Le code est public.")}</span></li>
      </ul>
    </DialogContent></Dialog>

    <Dialog open={panel === "cities"} onOpenChange={open => !open && setPanel("")}><DialogContent className="app-dialog">
      <div className="dialog-symbol"><MapPin size={24}/></div>
      <DialogTitle>{t("Où manjéo livre")}</DialogTitle>
      <DialogDescription>{t("La démonstration dessert trois communes en Guyane française. Trois communes, une même carte.")}</DialogDescription>
      <div className="city-picker">{cities.map(name => <button key={name} disabled={disabled} className={name === city ? "selected" : ""} aria-pressed={name === city}
        onClick={() => { if (!disabled) { onCity(name); setPanel(""); onNearby(); } }}><MapPin size={16}/>{name}</button>)}</div>
      <p className="dialog-note">{t("Livraison majorée de 1 € hors Cayenne dans cette démonstration.")}</p>
    </DialogContent></Dialog>

    <Dialog open={panel === "promotions"} onOpenChange={open => !open && setPanel("")}><DialogContent className="app-dialog">
      <div className="dialog-symbol"><Tag size={24}/></div>
      <DialogTitle>{t("Les codes du moment")}</DialogTitle>
      <DialogDescription>{t("À saisir dans votre panier avant de confirmer. Le montant exact est recalculé par le serveur.")}</DialogDescription>
      {promotionsLoading && <p className="dialog-note" role="status">{t("Recherche des promotions disponibles…")}</p>}
      {promotionsError && <><p className="checkout-error" role="alert">{t(promotionsError)}</p><Button variant="outline" onClick={() => setPromotionsAttempt(value => value + 1)}>{t("Réessayer")}</Button></>}
      {!promotionsLoading && promotions.length > 0 ? <ul className="promo-catalog">{promotions.map(promotion => <li key={promotion.code}>
        <code>{promotion.code}</code>
        <span><strong>{t(promotion.label)}</strong><small>{promotion.conditions.split(" · ").map(part => t(part)).join(" · ")}</small></span>
      </li>)}</ul> : !promotionsLoading && !promotionsError && <p className="dialog-note">{t("Aucun code n’est ouvert en ce moment.")}</p>}
    </DialogContent></Dialog>

    <Dialog open={panel === "install"} onOpenChange={open => !open && setPanel("")}><DialogContent className="app-dialog">
      <div className="dialog-symbol"><Download size={24}/></div>
      <DialogTitle>{t("Installer manjéo")}</DialogTitle>
      <DialogDescription>{t("manjéo est une application web : elle s’installe depuis le navigateur, sans passer par une boutique.")}</DialogDescription>
      <ul className="dialog-list">
        <li><strong>{t("Android, Chrome")}</strong><span>{t("Menu du navigateur, puis « Installer l’application » ou « Ajouter à l’écran d’accueil ».")}</span></li>
        <li><strong>{t("iPhone, Safari")}</strong><span>{t("Bouton Partager, puis « Sur l’écran d’accueil ».")}</span></li>
        <li><strong>{t("Ordinateur")}</strong><span>{t("Icône d’installation dans la barre d’adresse de Chrome ou Edge.")}</span></li>
        <li><strong>{t("Google Play et App Store")}</strong><span>{t("Aucune version publiée : utilisez cette démonstration depuis votre navigateur.")}</span></li>
      </ul>
    </DialogContent></Dialog>

    <Dialog open={panel === "grocery"} onOpenChange={open => !open && setPanel("")}><DialogContent className="app-dialog">
      <div className="dialog-symbol"><ShoppingBag size={24}/></div>
      <DialogTitle>{t("Faire ses courses")}</DialogTitle>
      <DialogDescription>{t("L’épicerie n’existe pas encore : manjéo ne livre aujourd’hui que des repas préparés par les six restaurants de la démonstration.")}</DialogDescription>
      <Button onClick={() => { setPanel(""); onNearby(); }}>{t("Voir les restaurants ouverts")} <ArrowRight size={17}/></Button>
    </DialogContent></Dialog>
  </>;
}
