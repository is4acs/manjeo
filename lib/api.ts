export type Role = "client" | "restaurant" | "admin";
export type User = { id: string; email: string; name: string; role: Role; restaurantId: string | null };
export type OrderStatus = "pending" | "accepted" | "preparing" | "ready" | "delivered" | "cancelled";
export type Order = {
  id: string; restaurantId: string; restaurant: string; customerId: string;
  customerName: string; phone: string; address: string; city: string; details: string; notes: string;
  status: OrderStatus; subtotal: number; delivery: number; total: number; count: number;
  date: string; updatedAt: string;
  items: { productId: string; name: string; option: string; price: number; quantity: number }[];
  history: { status: OrderStatus; date: string }[];
};
export const statusLabels: Record<OrderStatus, string> = {
  pending: "En attente", accepted: "Acceptée", preparing: "En préparation",
  ready: "Prête à livrer", delivered: "Livrée (test)", cancelled: "Annulée",
};
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {
      ...options, credentials: "same-origin", signal: options.signal || controller.signal,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    const data = await response.json().catch(() => ({ error: "Réponse du serveur illisible." }));
    if (!response.ok) {
      if (response.status === 401 && path !== "/api/login") window.dispatchEvent(new Event("manjeo-session-expired"));
      throw new ApiError(data.error || "La demande n’a pas abouti.", response.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Le serveur local ne répond pas. Réessayez dans quelques instants.");
  } finally { window.clearTimeout(timer); }
}
