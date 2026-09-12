"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Download, LifeBuoy, MapPin, ShoppingBag, Store, Tag } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api, type PublicPromotion } from "@/lib/api";

type Panel = "" | "help" | "about" | "cities" | "promotions" | "install" | "grocery";
type InstallPrompt = Event & { prompt: () => Promise<void> };

// Chaque entrée mène à une destination réelle de l'application. Ce qui n'existe pas
// encore dans cette démonstration est annoncé comme tel, jamais maquillé en lien mort.
export default function SiteFooter({city, cities, onCity, onAccount, onOrders, onNearby, onStaff}: {
  city: string; cities: string[]; onCity: (city: string) => void;
  onAccount: () => void; onOrders: () => void; onNearby: () => void; onStaff: () => void;
}) {
  const [panel, setPanel] = useState<Panel>("");
  const [promotions, setPromotions] = useState<PublicPromotion[]>([]);
  const [promotionsError, setPromotionsError] = useState("");
  const [installer, setInstaller] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstaller(event as InstallPrompt); };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);
  useEffect(() => {
    if (panel !== "promotions") return;
    void api<{promotions: PublicPromotion[]}>("/api/promotions")
      .then(data => { setPromotions(data.promotions); setPromotionsError(""); })
      .catch(error => setPromotionsError((error as Error).message));
  }, [panel]);

  async function install() {
    if (!installer) { setPanel("install"); return; }
    try { await installer.prompt(); } finally { setInstaller(null); }
  }

  const columns: {title: string; links: {label: string; action: () => void; note?: string}[]}[] = [
    {title: "Commander", links: [
      {label: "Restaurants à proximité", action: onNearby},
      {label: "Afficher toutes les villes", action: () => setPanel("cities")},
      {label: "Tous les pays", action: () => setPanel("cities")},
      {label: "Promotions", action: () => setPanel("promotions")},
      {label: "Mes commandes", action: onOrders},
    ]},
    {title: "Partenaires", links: [
      {label: "Ajoutez votre restaurant", action: onAccount},
      {label: "Devenez coursier-partenaire", action: onAccount},
      {label: "Créez un compte professionnel", action: onAccount},
      {label: "Commandes à récupérer à proximité", action: onStaff},
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
          <p>La Guyane a bon goût. Vos restos de Cayenne, Rémire-Montjoly et Matoury, livrés chaud.</p>
          <button className="footer-install" onClick={() => void install()}><Download size={17}/><span><strong>Installer l’application</strong><small>{installer ? "Ajouter manjéo à votre écran d’accueil" : "Application web · pas encore sur Google Play"}</small></span></button>
        </div>
        {columns.map(column => <nav key={column.title} aria-label={column.title}>
          <h2>{column.title}</h2>
          <ul>{column.links.map(link => <li key={link.label}>
            <button onClick={link.action}>{link.label}{link.note && <span className="footer-note">{link.note}</span>}</button>
          </li>)}</ul>
        </nav>)}
      </div>
      <div className="footer-legal">
        <span>© 2026 manjéo · Guyane française</span>
        <span>Démonstration en ligne · restaurants, prix et livraisons fictifs</span>
        <a href="https://github.com/is4acs/manjeo" target="_blank" rel="noreferrer noopener">Le code du projet</a>
      </div>
    </footer>

    <Dialog open={panel === "help"} onOpenChange={open => !open && setPanel("")}><DialogContent className="app-dialog">
      <div className="dialog-symbol"><LifeBuoy size={24}/></div>
      <DialogTitle>Obtenir de l’aide</DialogTitle>
      <DialogDescription>Cette démonstration est partagée : personne ne cuisine, ne roule ni n’encaisse réellement.</DialogDescription>
      <ul className="dialog-list">
        <li><strong>Passer une commande</strong><span>Connectez-vous avec <code>client@manjeo.test</code>, ajoutez un plat, puis confirmez. Le mot de passe commun est <code>ManjeoDemo2026!</code>.</span></li>
        <li><strong>Suivre les quatre espaces</strong><span>Le restaurant accepte et prépare, le livreur prend la course puis demande votre code à quatre chiffres, l’administration supervise.</span></li>
        <li><strong>Une commande a disparu</strong><span>Sans réponse du restaurant dans les dix minutes, elle s’annule d’elle-même et le code promo éventuel vous est rendu.</span></li>
        <li><strong>Un problème technique</strong><span>Ouvrez un ticket sur le dépôt du projet ; aucun support téléphonique n’existe pour cette démonstration.</span></li>
      </ul>
    </DialogContent></Dialog>

    <Dialog open={panel === "about"} onOpenChange={open => !open && setPanel("")}><DialogContent className="app-dialog">
      <div className="dialog-symbol"><Store size={24}/></div>
      <DialogTitle>Informations sur manjéo</DialogTitle>
      <DialogDescription>Un service de livraison de repas imaginé pour Cayenne, réalisé comme démonstration technique.</DialogDescription>
      <ul className="dialog-list">
        <li><strong>Ce qui est réel</strong><span>Le parcours complet : carte modifiable, panier vérifié côté serveur, commandes, affectation des livreurs, code de remise, historique.</span></li>
        <li><strong>Ce qui est fictif</strong><span>Les six restaurants, leurs cartes, leurs avis, les prix, les délais, les livreurs et tout paiement. Les photographies sont illustratives.</span></li>
        <li><strong>Zone desservie</strong><span>Cayenne, Rémire-Montjoly et Matoury, en Guyane française. Aucun autre pays n’est ouvert.</span></li>
        <li><strong>Technique</strong><span>Interface React et Vite, API Python, base PostgreSQL. Le code est public.</span></li>
      </ul>
    </DialogContent></Dialog>

    <Dialog open={panel === "cities"} onOpenChange={open => !open && setPanel("")}><DialogContent className="app-dialog">
      <div className="dialog-symbol"><MapPin size={24}/></div>
      <DialogTitle>Où manjéo livre</DialogTitle>
      <DialogDescription>Un seul pays desservi : la Guyane française. Trois communes, une même carte.</DialogDescription>
      <div className="city-picker">{cities.map(name => <button key={name} className={name === city ? "selected" : ""} aria-pressed={name === city}
        onClick={() => { onCity(name); setPanel(""); onNearby(); }}><MapPin size={16}/>{name}</button>)}</div>
      <p className="dialog-note">Livraison majorée de 1 € hors Cayenne dans cette démonstration.</p>
    </DialogContent></Dialog>

    <Dialog open={panel === "promotions"} onOpenChange={open => !open && setPanel("")}><DialogContent className="app-dialog">
      <div className="dialog-symbol"><Tag size={24}/></div>
      <DialogTitle>Les codes du moment</DialogTitle>
      <DialogDescription>À saisir dans votre panier avant de confirmer. Le montant exact est recalculé par le serveur.</DialogDescription>
      {promotionsError && <p className="checkout-error" role="alert">{promotionsError}</p>}
      {promotions.length > 0 ? <ul className="promo-catalog">{promotions.map(promotion => <li key={promotion.code}>
        <code>{promotion.code}</code>
        <span><strong>{promotion.label}</strong><small>{promotion.conditions}</small></span>
      </li>)}</ul> : !promotionsError && <p className="dialog-note">Aucun code n’est ouvert en ce moment.</p>}
    </DialogContent></Dialog>

    <Dialog open={panel === "install"} onOpenChange={open => !open && setPanel("")}><DialogContent className="app-dialog">
      <div className="dialog-symbol"><Download size={24}/></div>
      <DialogTitle>Installer manjéo</DialogTitle>
      <DialogDescription>manjéo est une application web : elle s’installe depuis le navigateur, sans passer par une boutique.</DialogDescription>
      <ul className="dialog-list">
        <li><strong>Android, Chrome</strong><span>Menu du navigateur, puis « Installer l’application » ou « Ajouter à l’écran d’accueil ».</span></li>
        <li><strong>iPhone, Safari</strong><span>Bouton Partager, puis « Sur l’écran d’accueil ».</span></li>
        <li><strong>Ordinateur</strong><span>Icône d’installation dans la barre d’adresse de Chrome ou Edge.</span></li>
        <li><strong>Google Play et App Store</strong><span>Aucune version publiée : ne cherchez pas manjéo dans les boutiques, ce serait une contrefaçon.</span></li>
      </ul>
    </DialogContent></Dialog>

    <Dialog open={panel === "grocery"} onOpenChange={open => !open && setPanel("")}><DialogContent className="app-dialog">
      <div className="dialog-symbol"><ShoppingBag size={24}/></div>
      <DialogTitle>Faire ses courses</DialogTitle>
      <DialogDescription>L’épicerie n’existe pas encore : manjéo ne livre aujourd’hui que des repas préparés par les six restaurants de la démonstration.</DialogDescription>
      <Button onClick={() => { setPanel(""); onNearby(); }}>Voir les restaurants ouverts <ArrowRight size={17}/></Button>
    </DialogContent></Dialog>
  </>;
}
