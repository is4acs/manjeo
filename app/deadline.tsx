"use client";
import { useEffect, useState } from "react";

// Échéances partagées par les quatre espaces : acceptation sous dix minutes, puis
// estimation de livraison. Le serveur reste seul juge ; ceci n'est que l'affichage.
export function useCountdown(deadline: string | null | undefined) {
  const [left, setLeft] = useState(() => (deadline ? Date.parse(deadline) - Date.now() : 0));
  useEffect(() => {
    if (!deadline) return;
    setLeft(Date.parse(deadline) - Date.now());
    const timer = window.setInterval(() => setLeft(Date.parse(deadline) - Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return deadline ? Math.max(0, Math.round(left / 1000)) : 0;
}

export const countdown = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
export const clockLabel = (value: string) => new Date(value).toLocaleTimeString("fr-FR", {timeZone: "America/Cayenne", hour: "2-digit", minute: "2-digit"});
export const isLate = (eta: string | null, status: string) => !!eta && Date.parse(eta) < Date.now() && !["delivered", "cancelled"].includes(status);
