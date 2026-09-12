const terminal = new Set(["delivered", "cancelled"]);
export function remainingSeconds(deadline: string | null | undefined, now = Date.now()): number {
  const target = deadline ? Date.parse(deadline) : NaN;
  return Number.isFinite(target) ? Math.max(0, Math.ceil((target - now) / 1000)) : 0;
}
export function countdown(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
export function clockLabel(value: string): string {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString("fr-FR", {timeZone: "America/Cayenne", hour: "2-digit", minute: "2-digit"}) : "Horaire indisponible";
}
export function isLate(eta: string | null | undefined, status: string, now = Date.now()): boolean {
  return !!eta && Number.isFinite(Date.parse(eta)) && Date.parse(eta) < now && !terminal.has(status);
}
