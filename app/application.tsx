import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Bike, ChefHat, LogOut, ShieldCheck, ShoppingBag, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type User, type Role } from "@/lib/api";
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
  const sessionVersion = useRef(0);
  const currentUser = useRef(user);
  currentUser.current = user;
  function notifySessionChange() {
    try { localStorage.setItem("manjeo-session-change", crypto.randomUUID()); } catch {}
  }

  async function initialize() {
    setLoading(true); setInitialError("");
    try {
      const [session, catalog] = await Promise.all([api<{user: User | null}>("/api/session"), api<{restaurants: Restaurant[]}>("/api/restaurants")]);
      if (!catalog.restaurants.length) throw new Error("Le catalogue est indisponible. Réessayez dans quelques instants.");
      setUser(session.user); setStaff(!!session.user && session.user.role !== "client"); setRestaurants(catalog.restaurants);
    } catch (error) { setInitialError((error as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void initialize(); }, []);
  useEffect(() => {
    const expired = () => { setUser(null); setStaff(false); setAccountOpen(true); setAuthError("Votre session a expiré. Reconnectez-vous pour continuer."); };
    window.addEventListener("manjeo-session-expired", expired);
    return () => window.removeEventListener("manjeo-session-expired", expired);
  }, []);
  useEffect(() => {
    const synchronize = async () => {
      const version = sessionVersion.current;
      try {
        const session = await api<{user: User | null}>("/api/session");
        if (version !== sessionVersion.current || currentUser.current?.id === session.user?.id) return;
        setUser(session.user); setStaff(!!session.user && session.user.role !== "client"); setAccountOpen(false);
      } catch { /* A temporary connection failure does not discard the session. */ }
    };
    const onStorage = (event: StorageEvent) => { if (event.key === "manjeo-session-change") void synchronize(); };
    const onFocus = () => { void synchronize(); };
    window.addEventListener("storage", onStorage); window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("focus", onFocus); };
  }, []);
  const refreshCatalog = useCallback(async () => {
    const data = await api<{restaurants: Restaurant[]}>("/api/restaurants");
    setRestaurants(data.restaurants);
    return data.restaurants;
  }, []);
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setAuthError("");
    ++sessionVersion.current;
    try {
      const result = await api<{user: User}>("/api/login", {method:"POST", body:JSON.stringify({email,password})});
      setUser(result.user); setStaff(result.user.role !== "client"); setAccountOpen(false);
      notifySessionChange();
      void refreshCatalog().catch(() => {});
    } catch (error) { setAuthError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return; setBusy(true); setAuthError("");
    ++sessionVersion.current;
    try {
      await api("/api/logout", {method:"POST", body:"{}"});
      setUser(null); setStaff(false); setAccountOpen(true);
      notifySessionChange();
      void refreshCatalog().catch(() => {});
    } catch (error) { setAccountOpen(true); setAuthError((error as Error).message); }
    finally { setBusy(false); }
  }
  if (loading || initialError) return <main className="app-startup"><span className="brand">manjéo✳</span><div className="startup-card"><ShoppingBag size={32}/><h1>{loading ? "Les bonnes adresses arrivent…" : "La cuisine se fait attendre"}</h1><p>{loading ? "Connexion à Manjéo." : initialError}</p>{initialError && <Button className="primary-btn" onClick={initialize}>Réessayer</Button>}</div></main>;
  return <>
    {staff && user && user.role !== "client"
      ? <Staff key={user.id} user={user} onLogout={() => void logout()} onShop={() => {setStaff(false); void refreshCatalog().catch(() => {});}}/>
      : <Home user={user} restaurants={restaurants} refreshCatalog={refreshCatalog} onAccount={() => {setAuthError("");setAccountOpen(true);}} onStaff={() => setStaff(true)}/>}
    <Dialog open={accountOpen} onOpenChange={open => {if (!busy) setAccountOpen(open);}}><DialogContent className="app-dialog account-dialog">
      {user ? <>
        <div className="account-symbol"><UserRound size={26}/></div><DialogTitle>Bonjour, {user.name}</DialogTitle><DialogDescription>{roleNames[user.role]} · Démonstration partagée</DialogDescription>
        <div className="account-identity"><strong>{user.email}</strong><span>Votre session est connectée.</span></div>
        {user.role !== "client" && <Button className="primary-btn" onClick={() => {setAccountOpen(false);setStaff(true);}}>Ouvrir {user.role === "admin" ? "l’administration" : user.role === "courier" ? "mes livraisons" : "mon restaurant"}<ArrowRight size={17}/></Button>}
        {authError && <p role="alert" className="account-error">{authError}</p>}
        <Button variant="outline" disabled={busy} onClick={() => void logout()}><LogOut size={16}/>{busy ? "Déconnexion…" : "Se déconnecter / changer de compte"}</Button>
      </> : <>
        <div className="account-symbol"><UserRound size={26}/></div><DialogTitle>Bienvenue à table.</DialogTitle><DialogDescription>Connectez-vous pour commander ou gérer votre activité.</DialogDescription>
        <div className="demo-account-picker" aria-label="Comptes de démonstration">{demos.map(({role,label,email:demoEmail,icon:Icon}) => <button key={role} type="button" aria-pressed={email === demoEmail} onClick={() => {setEmail(demoEmail);setPassword("ManjeoDemo2026!");setAuthError("");}}><Icon size={20}/>{label}</button>)}</div>
        <form className="account-form" onSubmit={login}><label>Adresse e-mail<Input type="email" name="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)}/></label><label>Mot de passe<Input type="password" name="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label>{authError && <p role="alert" className="account-error">{authError}</p>}<Button className="primary-btn" type="submit" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}<ArrowRight size={17}/></Button></form>
        <p className="demo-credentials">4 comptes de démonstration partagés. Mot de passe commun :<br/><code>ManjeoDemo2026!</code></p>
      </>}
    </DialogContent></Dialog>
  </>;
}
