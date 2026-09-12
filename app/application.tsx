import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Bike, ChefHat, LogOut, ShieldCheck, ShoppingBag, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type LanguageOption, type User, type Role } from "@/lib/api";
import { type Restaurant } from "@/lib/menu";
import Home from "./page";
import Staff from "./staff";
import "./accounts.css";

const demos = [
  { role: "client", label: "Client", email: "client@manjeo.test", icon: ShoppingBag },
  { role: "restaurant", label: "Restaurant", email: "restaurant@manjeo.test", icon: ChefHat },
  { role: "courier", label: "Livreur", email: "livreur@manjeo.test", icon: Bike },
  { role: "admin", label: "Admin", email: "admin@manjeo.test", icon: ShieldCheck },
] as const;
const roleNames: Record<Role, string> = { client: "Espace client", restaurant: "Espace restaurateur", courier: "Espace livreur", admin: "Administration" };
const emptyProfile = {name: "", phone: "", language: "fr"};
const profileOf = (user: User | null) => user ? {name: user.name, phone: user.phone || "", language: user.language || "fr"} : emptyProfile;

export default function Application() {
  const [user, setUser] = useState<User | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialError, setInitialError] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [staff, setStaff] = useState(false);
  const [email, setEmail] = useState("client@manjeo.test");
  const [password, setPassword] = useState("ManjeoDemo2026!");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [profileDraft, setProfileDraft] = useState(emptyProfile);
  const [requestedRole, setRequestedRole] = useState<Role | null>(null);
  const sessionVersion = useRef(0);
  const sessionRead = useRef(0);
  const catalogRead = useRef(0);
  const currentUser = useRef(user);
  const mounted = useRef(true);
  const mutation = useRef<"" | "auth" | "profile">("");
  currentUser.current = user;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++sessionVersion.current; ++sessionRead.current; ++catalogRead.current; }; }, []);
  function notifySessionChange() { try { localStorage.setItem("manjeo-session-change", crypto.randomUUID()); } catch {} }
  function selectDemo(role: Role) { const account = demos.find(item => item.role === role)!; setEmail(account.email); setPassword("ManjeoDemo2026!"); }
  function openAccount(role?: Role) {
    setAuthError(""); setProfileNotice(""); setProfileDraft(profileOf(currentUser.current));
    setRequestedRole(role || null); if (role) selectDemo(role); setAccountOpen(true);
  }

  async function initialize() {
    const version = ++sessionVersion.current;
    setLoading(true); setInitialError("");
    try {
      const [session, catalog] = await Promise.all([api<{user: User | null}>("/api/session"), api<{restaurants: Restaurant[]}>("/api/restaurants")]);
      if (!mounted.current || version !== sessionVersion.current) return;
      if (!catalog.restaurants.length) throw new Error("Le catalogue est indisponible. Réessayez dans quelques instants.");
      setUser(session.user); setProfileDraft(profileOf(session.user)); setStaff(!!session.user && session.user.role !== "client"); setRestaurants(catalog.restaurants);
    } catch (error) { if (mounted.current && version === sessionVersion.current) setInitialError((error as Error).message); }
    finally { if (mounted.current && version === sessionVersion.current) setLoading(false); }
  }
  useEffect(() => { void initialize(); }, []);
  useEffect(() => {
    const expired = async () => {
      if (mutation.current) return;
      const version = sessionVersion.current;
      const read = ++sessionRead.current;
      try {
        // A late 401 can belong to the previous account, before a fresh login.
        const session = await api<{user: User | null}>("/api/session");
        if (!mounted.current || mutation.current || version !== sessionVersion.current || read !== sessionRead.current) return;
        if (session.user) {
          const changedAccount = currentUser.current?.id !== session.user.id;
          currentUser.current = session.user; setUser(session.user);
          if (changedAccount) { ++sessionVersion.current; setProfileDraft(profileOf(session.user)); setProfileNotice(""); setStaff(session.user.role !== "client"); setAccountOpen(false); }
          return;
        }
        ++sessionVersion.current; ++sessionRead.current; currentUser.current = null; setUser(null); setStaff(false); setAccountOpen(true); setProfileDraft(emptyProfile); setProfileNotice(""); setAuthError("Votre session a expiré. Reconnectez-vous pour continuer.");
      } catch { /* A network failure does not prove that the session expired. */ }
    };
    window.addEventListener("manjeo-session-expired", expired);
    return () => window.removeEventListener("manjeo-session-expired", expired);
  }, []);
  useEffect(() => {
    const synchronize = async (force = false) => {
      if (mutation.current && !force) return;
      const version = sessionVersion.current;
      const read = ++sessionRead.current;
      try {
        const session = await api<{user: User | null}>("/api/session");
        if (!mounted.current || mutation.current && !force || version !== sessionVersion.current || read !== sessionRead.current) return;
        const changedAccount = currentUser.current?.id !== session.user?.id;
        currentUser.current = session.user; setUser(session.user);
        if (changedAccount) { ++sessionVersion.current; setProfileDraft(profileOf(session.user)); setProfileNotice(""); setStaff(!!session.user && session.user.role !== "client"); setAccountOpen(false); }
      } catch { /* Temporary failure keeps the current session; a later focus/poll retries. */ }
    };
    const onStorage = (event: StorageEvent) => { if (event.key === "manjeo-session-change") { ++sessionVersion.current; void synchronize(true); } };
    const onFocus = () => { void synchronize(); };
    window.addEventListener("storage", onStorage); window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("focus", onFocus); };
  }, []);
  useEffect(() => {
    if (!user) { setLanguages([]); return; }
    const userId = user.id;
    let active = true;
    void api<{languages: LanguageOption[]}>("/api/profile").then(data => { if (active && currentUser.current?.id === userId) setLanguages(data.languages); }).catch(() => {});
    return () => { active = false; };
  }, [user?.id]);
  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.current || !currentUser.current) return;
    const userId = currentUser.current.id;
    const version = sessionVersion.current;
    ++sessionRead.current;
    mutation.current = "profile"; setProfileBusy(true); setAuthError(""); setProfileNotice("");
    try {
      const result = await api<{user: User}>("/api/profile", {method: "PATCH", body: JSON.stringify({name: profileDraft.name.trim(), phone: profileDraft.phone.trim(), language: profileDraft.language})});
      if (!mounted.current || version !== sessionVersion.current || currentUser.current?.id !== userId || result.user.id !== userId) return;
      currentUser.current = result.user; setUser(result.user); setProfileDraft(profileOf(result.user)); setProfileNotice("Vos coordonnées sont enregistrées."); notifySessionChange();
    } catch (error) { if (mounted.current && version === sessionVersion.current && currentUser.current?.id === userId) setAuthError((error as Error).message); }
    finally { mutation.current = ""; if (mounted.current) setProfileBusy(false); }
  }
  const refreshCatalog = useCallback(async () => {
    const read = ++catalogRead.current;
    const data = await api<{restaurants: Restaurant[]}>("/api/restaurants");
    if (!data.restaurants.length) throw new Error("Le catalogue est temporairement indisponible.");
    if (mounted.current && read === catalogRead.current) setRestaurants(data.restaurants);
    return data.restaurants;
  }, []);
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (mutation.current) return;
    mutation.current = "auth"; setBusy(true); setAuthError("");
    const version = ++sessionVersion.current;
    try {
      const result = await api<{user: User}>("/api/login", {method:"POST", body:JSON.stringify({email,password})});
      if (!mounted.current || version !== sessionVersion.current) return;
      currentUser.current = result.user; setUser(result.user); setProfileDraft(profileOf(result.user)); setStaff(result.user.role !== "client"); setAccountOpen(false); setRequestedRole(null); setProfileNotice("");
      notifySessionChange(); void refreshCatalog().catch(() => {});
    } catch (error) { if (mounted.current && version === sessionVersion.current) setAuthError((error as Error).message); }
    finally { mutation.current = ""; if (mounted.current) setBusy(false); }
  }
  async function logout(nextRole?: Role) {
    if (mutation.current) return;
    mutation.current = "auth"; setBusy(true); setAuthError("");
    const version = ++sessionVersion.current;
    try {
      await api("/api/logout", {method:"POST", body:"{}"});
      if (!mounted.current || version !== sessionVersion.current) return;
      currentUser.current = null; setUser(null); setStaff(false); setAccountOpen(true); setProfileNotice(""); setProfileDraft(emptyProfile);
      if (nextRole) { selectDemo(nextRole); setRequestedRole(nextRole); }
      notifySessionChange(); void refreshCatalog().catch(() => {});
    } catch (error) { if (mounted.current && version === sessionVersion.current) { setAccountOpen(true); setAuthError((error as Error).message); } }
    finally { mutation.current = ""; if (mounted.current) setBusy(false); }
  }
  if (loading || initialError) return <main className="app-startup"><span className="brand">manjéo</span><div className="startup-card"><ShoppingBag size={32}/><h1>{loading ? "Les bonnes adresses arrivent…" : "La cuisine se fait attendre"}</h1><p>{loading ? "Connexion à Manjéo." : initialError}</p>{initialError && <Button onClick={initialize}>Réessayer</Button>}</div></main>;
  const locked = busy || profileBusy;
  return <>
    {staff && user && user.role !== "client"
      ? <Staff key={user.id} user={user} onLogout={() => void logout()} onAccount={() => openAccount()} onShop={() => {setStaff(false); void refreshCatalog().catch(() => {});}}/>
      : <Home user={user} restaurants={restaurants} refreshCatalog={refreshCatalog} onAccount={openAccount} onStaff={() => setStaff(true)}/>}
    <Dialog open={accountOpen} onOpenChange={open => {if (!locked) setAccountOpen(open);}}><DialogContent className="app-dialog account-dialog">
      {user ? <>
        <div className="account-symbol"><UserRound size={26}/></div><DialogTitle>Bonjour, {user.name}</DialogTitle><DialogDescription>{roleNames[user.role]} · Démonstration partagée</DialogDescription>
        <div className="account-identity"><strong>{user.email}</strong><span>Votre session est connectée.</span></div>
        {requestedRole && requestedRole !== user.role && <div className="account-switch-role"><p>Pour ouvrir {roleNames[requestedRole].toLowerCase()}, utilisez le compte de démonstration correspondant.</p><Button type="button" disabled={locked} onClick={() => void logout(requestedRole)}>Changer pour le compte {demos.find(item => item.role === requestedRole)?.label.toLowerCase()}</Button></div>}
        <form className="account-form profile-form" key={user.id} onSubmit={saveProfile}>
          <fieldset disabled={locked} className="profile-fields">
          <label>Nom affiché<Input name="name" value={profileDraft.name} onChange={event => setProfileDraft({...profileDraft, name: event.target.value})} required minLength={2} maxLength={100} autoComplete="name"/></label>
          <label>Téléphone<Input name="phone" type="tel" value={profileDraft.phone} onChange={event => setProfileDraft({...profileDraft, phone: event.target.value})} maxLength={30} autoComplete="tel" placeholder="0694 00 00 00"/><small>Vos interlocuteurs autorisés peuvent vous joindre pendant leur prise en charge de la commande.</small></label>
          <label>Langue des messages<select name="language" value={profileDraft.language} onChange={event => setProfileDraft({...profileDraft, language: event.target.value})}>{(languages.length ? languages : [{code: profileDraft.language, label: profileDraft.language}]).map(option => <option key={option.code} value={option.code}>{option.label}</option>)}</select><small>Vous écrivez dans cette langue ; la conversation indique les traductions disponibles.</small></label>
          {profileNotice && <p className="account-notice" role="status">{profileNotice}</p>}
          <Button type="submit" variant="outline" disabled={locked}>{profileBusy ? "Enregistrement…" : "Enregistrer mes coordonnées"}</Button>
          </fieldset>
        </form>
        {user.role !== "client" && <Button disabled={locked} onClick={() => {setAccountOpen(false);setStaff(true);}}>Ouvrir {user.role === "admin" ? "l’administration" : user.role === "courier" ? "mes livraisons" : "mon restaurant"}<ArrowRight size={17}/></Button>}
        {authError && <p role="alert" className="account-error">{authError}</p>}
        <Button variant="outline" disabled={locked} onClick={() => void logout()}><LogOut size={16}/>{busy ? "Déconnexion…" : "Se déconnecter / changer de compte"}</Button>
      </> : <>
        <div className="account-symbol"><UserRound size={26}/></div><DialogTitle>Bienvenue à table.</DialogTitle><DialogDescription>{requestedRole ? `Connectez-vous pour ouvrir ${roleNames[requestedRole].toLowerCase()}.` : "Connectez-vous pour commander ou gérer votre activité."}</DialogDescription>
        <div className="demo-account-picker" aria-label="Comptes de démonstration">{demos.map(({role,label,email:demoEmail,icon:Icon}) => <button key={role} type="button" disabled={locked} aria-pressed={email === demoEmail} onClick={() => {selectDemo(role);setRequestedRole(role);setAuthError("");}}><Icon size={20}/>{label}</button>)}</div>
        <form className="account-form" onSubmit={login}><label>Adresse e-mail<Input type="email" name="email" autoComplete="username" required disabled={locked} value={email} onChange={event => setEmail(event.target.value)}/></label><label>Mot de passe<Input type="password" name="password" autoComplete="current-password" required disabled={locked} value={password} onChange={event => setPassword(event.target.value)}/></label>{authError && <p role="alert" className="account-error">{authError}</p>}<Button type="submit" disabled={locked}>{busy ? "Connexion…" : "Se connecter"}<ArrowRight size={17}/></Button></form>
        <p className="demo-credentials">4 comptes de démonstration partagés. Mot de passe commun :<br/><code>ManjeoDemo2026!</code></p>
      </>}
    </DialogContent></Dialog>
  </>;
}
