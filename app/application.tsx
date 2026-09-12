import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Bike, ChefHat, LogOut, ShieldCheck, ShoppingBag, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type User, type Role } from "@/lib/api";
import { type Restaurant } from "@/lib/menu";
import { t, documentLanguage, getLanguage, normalizeLanguage, type UILanguage } from "@/lib/i18n";
import { LanguageBar, useLanguage, chooseLanguage, adoptProfileLanguage, hasLanguageChoice } from "./i18n";
import CustomerAccount from "./customer-account";
import { localizeInvalid, clearValidity, refreshValidationLanguage } from "./validation";
import Home from "./page";
import RouteBoundary from "./route-boundary";
import "./accounts.css";

const Staff = lazy(() => import("./staff"));

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
  const uiLanguage = useLanguage();
  useEffect(() => { refreshValidationLanguage(); document.documentElement.lang = documentLanguage(uiLanguage); document.title = t("Manjéo · Commandez en Guyane"); }, [uiLanguage]);
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
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [profileDraft, setProfileDraft] = useState(emptyProfile);
  const [requestedRole, setRequestedRole] = useState<Role | null>(null);
  const languageAttempt = useRef("");
  const sessionVersion = useRef(0);
  const sessionRead = useRef(0);
  const catalogRead = useRef(0);
  const currentUser = useRef(user);
  const mounted = useRef(true);
  const initializing = useRef(true);
  const pendingSessionSync = useRef(false);
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
    ++sessionRead.current;
    initializing.current = true; pendingSessionSync.current = false;
    setLoading(true); setInitialError("");
    try {
      const [initialSession, catalog] = await Promise.all([api<{user: User | null}>("/api/session"), api<{restaurants: Restaurant[]}>("/api/restaurants")]);
      if (!mounted.current || version !== sessionVersion.current) return;
      if (!catalog.restaurants.length) throw new Error("Le catalogue est indisponible. Réessayez dans quelques instants.");
      // Session events must not abandon the only request that loads the catalog.
      // Re-read after an event, including one received during this fresh read.
      let session = initialSession;
      while (pendingSessionSync.current) {
        pendingSessionSync.current = false;
        session = await api<{user: User | null}>("/api/session");
        if (!mounted.current || version !== sessionVersion.current) return;
      }
      currentUser.current = session.user; setUser(session.user); setProfileDraft(profileOf(session.user)); setStaff(!!session.user && session.user.role !== "client"); setRestaurants(catalog.restaurants);
    } catch (error) { if (mounted.current && version === sessionVersion.current) setInitialError((error as Error).message); }
    finally { if (mounted.current && version === sessionVersion.current) { initializing.current = false; setLoading(false); } }
  }
  useEffect(() => { void initialize(); }, []);
  useEffect(() => {
    const expired = async () => {
      if (initializing.current) { pendingSessionSync.current = true; return; }
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
      if (initializing.current) { pendingSessionSync.current = true; return; }
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
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "manjeo-session-change") return;
      if (initializing.current) { pendingSessionSync.current = true; return; }
      ++sessionVersion.current; void synchronize(true);
    };
    const onFocus = () => { void synchronize(); };
    window.addEventListener("storage", onStorage); window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("focus", onFocus); };
  }, []);
  useEffect(() => { if (user) adoptProfileLanguage(user.language); }, [user?.id, user?.language]);
  async function selectLanguage(value: UILanguage) {
    if (mutation.current) return;
    chooseLanguage(value);
    const account = currentUser.current;
    if (!account) return;
    setProfileDraft(draft => ({...draft,language:value}));
    if (account.language === value) return;
    languageAttempt.current = `${account.id}:${value}`;
    const version = sessionVersion.current;
    ++sessionRead.current; mutation.current = "profile"; setProfileBusy(true); setAuthError("");
    try {
      const result = await api<{user:User}>("/api/profile",{method:"PATCH",body:JSON.stringify({language:value})});
      if (!mounted.current || version !== sessionVersion.current || currentUser.current?.id !== account.id || result.user.id !== account.id) return;
      currentUser.current = result.user; setUser(result.user); notifySessionChange();
    } catch {
      if (mounted.current && version === sessionVersion.current) { setAuthError("La langue est affichée sur cet appareil, mais sa sauvegarde sur le compte a échoué. Réessayez depuis Mon compte."); setAccountOpen(true); }
    } finally { mutation.current = ""; if (mounted.current) setProfileBusy(false); }
  }
  useEffect(() => {
    if (!user || loading || busy || profileBusy || mutation.current) return;
    const value = getLanguage();
    if ((hasLanguageChoice() || !normalizeLanguage(user.language)) && user.language !== value && languageAttempt.current !== `${user.id}:${value}`) {
      void selectLanguage(value);
    }
  }, [user?.id, user?.language, uiLanguage, loading, busy, profileBusy]);
  const saveCustomerProfile = useCallback(async (payload: Record<string, unknown>) => {
    const account = currentUser.current;
    if (!account || account.role !== 'client' || mutation.current) throw new Error('Une modification du compte est déjà en cours. Réessayez.');
    const version = sessionVersion.current;
    const read = ++sessionRead.current;
    mutation.current = 'profile'; setProfileBusy(true);
    try {
      const result = await api<{user:User}>('/api/profile', {method:'PATCH', body:JSON.stringify(payload)});
      if (!mounted.current || sessionVersion.current !== version || sessionRead.current !== read || currentUser.current?.id !== account.id || result.user.id !== account.id) throw new Error('Le compte connecté a changé. Réessayez.');
      currentUser.current = result.user; setUser(result.user); setProfileDraft(profileOf(result.user)); notifySessionChange();
      return result.user;
    } finally {mutation.current = ''; if (mounted.current) setProfileBusy(false);}
  }, []);
  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.current || !currentUser.current) return;
    const userId = currentUser.current.id;
    const version = sessionVersion.current;
    ++sessionRead.current;
    mutation.current = "profile"; setProfileBusy(true); setAuthError(""); setProfileNotice("");
    try {
      const result = await api<{user: User}>("/api/profile", {method: "PATCH", body: JSON.stringify({name: profileDraft.name.trim(), phone: profileDraft.phone.trim(), language: getLanguage()})});
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
  if (loading || initialError) return <><LanguageBar onChange={value => chooseLanguage(value)}/><main className="app-startup"><span className="brand">manjéo</span><div className="startup-card"><ShoppingBag size={32}/><h1>{loading ? t("Les bonnes adresses arrivent…") : t("La cuisine se fait attendre")}</h1><p>{loading ? t("Connexion à Manjéo.") : t(initialError)}</p>{initialError && <Button onClick={initialize}>{t("Réessayer")}</Button>}</div></main></>;
  const locked = busy || profileBusy;
  const viewer = user ? {...user,language:uiLanguage} : null;
  return <div className="localized-app" onInvalidCapture={localizeInvalid} onInputCapture={clearValidity}>
    <LanguageBar onChange={value => void selectLanguage(value)} disabled={locked}/>
    {staff && user && user.role !== "client"
      ? <RouteBoundary key={user.id} onShop={() => setStaff(false)}><Suspense fallback={<main className="app-startup"><span className="brand">manjéo</span><div className="startup-card" role="status"><p>{t("Chargement de votre espace…")}</p></div></main>}><Staff user={viewer!} onLogout={() => void logout()} onAccount={() => openAccount()} onShop={() => {setStaff(false); void refreshCatalog().catch(() => {});}}/></Suspense></RouteBoundary>
      : <Home user={viewer} onSaveProfile={saveCustomerProfile} restaurants={restaurants} refreshCatalog={refreshCatalog} onAccount={openAccount} onStaff={() => setStaff(true)}/>}
    <Dialog open={accountOpen} onOpenChange={open => {if (!locked) setAccountOpen(open);}}><DialogContent className="app-dialog account-dialog">
      {user ? <>
        <div className="account-symbol"><UserRound size={26}/></div><DialogTitle>{t("Bonjour, {name}", {name: user.name})}</DialogTitle><DialogDescription>{t(roleNames[user.role])} · {t("Démonstration partagée")}</DialogDescription>
        <div className="account-identity"><strong>{user.email}</strong><span>{t("Votre session est connectée.")}</span></div>
        {requestedRole && requestedRole !== user.role && <div className="account-switch-role"><p>{t("Pour ouvrir {space}, utilisez le compte de démonstration correspondant.", {space: t(roleNames[requestedRole]).toLowerCase()})}</p><Button type="button" disabled={locked} onClick={() => void logout(requestedRole)}>{t("Changer pour le compte {role}", {role: t(demos.find(item => item.role === requestedRole)?.label || "Client").toLowerCase()})}</Button></div>}
        {user.role === "client" ? <CustomerAccount key={user.id} user={viewer!} disabled={locked} onSaveProfile={saveCustomerProfile}/> : <form className="account-form profile-form" key={user.id} onSubmit={saveProfile}>
          <fieldset disabled={locked} className="profile-fields">
          <label>{t("Nom affiché")}<Input name="name" value={profileDraft.name} onChange={event => setProfileDraft({...profileDraft, name: event.target.value})} required minLength={2} maxLength={100} autoComplete="name"/></label>
          <label>{t("Téléphone")}<Input name="phone" type="tel" value={profileDraft.phone} onChange={event => setProfileDraft({...profileDraft, phone: event.target.value})} maxLength={30} autoComplete="tel" placeholder="0694 00 00 00"/><small>{t("Vos interlocuteurs autorisés peuvent vous joindre pendant leur prise en charge de la commande.")}</small></label>
          {profileNotice && <p className="account-notice" role="status">{t(profileNotice)}</p>}
          <Button type="submit" variant="outline" disabled={locked}>{profileBusy ? t("Enregistrement…") : t("Enregistrer mes coordonnées")}</Button>
          </fieldset>
        </form>}
        {user.role !== "client" && <Button disabled={locked} onClick={() => {setAccountOpen(false);setStaff(true);}}>{t(user.role === "admin" ? "Ouvrir l’administration" : user.role === "courier" ? "Ouvrir mes livraisons" : "Ouvrir mon restaurant")}<ArrowRight size={17}/></Button>}
        {authError && <p role="alert" className="account-error">{t(authError)}</p>}
        <Button variant="outline" disabled={locked} onClick={() => void logout()}><LogOut size={16}/>{busy ? t("Déconnexion…") : t("Se déconnecter / changer de compte")}</Button>
      </> : <>
        <div className="account-symbol"><UserRound size={26}/></div><DialogTitle>{t("Bienvenue à table.")}</DialogTitle><DialogDescription>{requestedRole ? t("Connectez-vous pour ouvrir {space}.", {space: t(roleNames[requestedRole]).toLowerCase()}) : t("Connectez-vous pour commander ou gérer votre activité.")}</DialogDescription>
        <div className="demo-account-picker" aria-label={t("Comptes de démonstration")}>{demos.map(({role,label,email:demoEmail,icon:Icon}) => <button key={role} type="button" disabled={locked} aria-pressed={email === demoEmail} onClick={() => {selectDemo(role);setRequestedRole(role);setAuthError("");}}><Icon size={20}/>{t(label)}</button>)}</div>
        <form className="account-form" onSubmit={login}><label>{t("Adresse e-mail")}<Input type="email" name="email" autoComplete="username" required disabled={locked} value={email} onChange={event => setEmail(event.target.value)}/></label><label>{t("Mot de passe")}<Input type="password" name="password" autoComplete="current-password" required disabled={locked} value={password} onChange={event => setPassword(event.target.value)}/></label>{authError && <p role="alert" className="account-error">{t(authError)}</p>}<Button type="submit" disabled={locked}>{busy ? t("Connexion…") : t("Se connecter")}<ArrowRight size={17}/></Button></form>
        <p className="demo-credentials">{t("4 comptes de démonstration partagés. Mot de passe commun :")}<br/><code>ManjeoDemo2026!</code></p>
      </>}
    </DialogContent></Dialog>
  </div>;
}
