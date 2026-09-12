"use client";
import { useEffect, useState } from "react";
import { remainingSeconds } from "./delivery-time";
export { countdown, clockLabel, isLate } from "./delivery-time";

// The timer is display-only. Transitions and deadline expiry remain server decisions.
export function useCountdown(deadline: string | null | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!deadline || !Number.isFinite(Date.parse(deadline))) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [deadline]);
  return remainingSeconds(deadline, now);
}
