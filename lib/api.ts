export type Role = "client" | "restaurant" | "courier" | "admin";
export type DeliveryLocation = {latitude: number; longitude: number; provider: 'ign'; precision: 'house' | 'street'; verifiedAt: string; confirmedAt: string};
export type DeliveryAddress = DeliveryLocation & {address: string; city: string; details: string; verificationExpiresAt: string};
export type AddressCandidate = Omit<DeliveryLocation, 'verifiedAt' | 'confirmedAt'> & {address: string; city: string; verificationToken: string; expiresAt: string};
export type PaymentMethod = 'demo' | 'stripe';
export type PaymentConfig = {mode: 'demo' | 'stripe_test'; stripeAvailable: boolean; reason: string | null};
export type User = { id: string; email: string; name: string; role: Role; restaurantId: string | null; phone: string; language: string; deliveryAddress?: DeliveryAddress | null; paymentMethod?: PaymentMethod };
export type OrderStatus = "awaiting_payment" | "pending" | "accepted" | "preparing" | "ready" | "picked_up" | "delivered" | "cancelled";
export type Order = {
  id: string; restaurantId: string; restaurant: string; customerId: string;
  customerName: string; phone: string; address: string; city: string; details: string; notes: string;
  status: OrderStatus; subtotal: number; delivery: number; discount: number; total: number; count: number;
  promoCode: string | null; promoLabel: string;
  date: string; updatedAt: string; acceptBy: string | null; eta: string | null;
  courierId: string | null; courierName: string | null;
  pickupAddress: string; pickupCity: string; deliveryCode?: string;
  deliveryLocation?: DeliveryLocation;
  payment?: {provider: PaymentMethod; status: 'simulated' | 'awaiting_payment' | 'paid' | 'expired' | 'cancelled' | 'refund_pending' | 'refunded' | 'refund_failed'; testMode: boolean};
  items: { productId: string; name: string; option: string; price: number; quantity: number }[];
  history: { status: OrderStatus; date: string; label?: string; actorName?: string }[];
};
export type ThreadMessage = { id: string; senderRole: Role; senderName: string; body: string; language: string; phraseId: string; date: string; mine: boolean };
export type ContactCard = { role: Role; label: string; name: string; phone: string; language: string; note: string };
export type Thread = { messages: ThreadMessage[]; contacts: ContactCard[]; viewerRole: Role; viewerId: string; language: string; open: boolean };
export type LanguageOption = { code: string; label: string };
export type AddressSuggestion = { label: string; number: string; street: string; city: string };
export type Promotion = { code: string; label: string; conditions: string; discount: number };
export type PublicPromotion = { code: string; label: string; conditions: string; restaurantId: string | null; minimum: number };
export type CourierProfile = { id: string; name: string; email: string; online: boolean; activeOrderId: string | null };
export type DeliveryOffer = Pick<Order, "id" | "restaurantId" | "restaurant" | "pickupAddress" | "pickupCity" | "city" | "count" | "status" | "delivery" | "date">;
export const statusLabels: Record<OrderStatus, string> = {
  awaiting_payment: "Paiement à terminer",
  pending: "En attente", accepted: "Acceptée", preparing: "En préparation",
  ready: "Prête au retrait", picked_up: "En livraison", delivered: "Livrée (test)", cancelled: "Annulée",
};
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(path, {
      ...options, credentials: "same-origin", signal: controller.signal,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    const data = await response.json().catch(() => { throw new ApiError("Réponse du serveur illisible. Réessayez.", response.status >= 400 ? response.status : 502); });
    if (!response.ok) {
      if (response.status === 401 && path !== "/api/login" && path !== "/api/session") window.dispatchEvent(new Event("manjeo-session-expired"));
      throw new ApiError(data.error || "La demande n’a pas abouti.", response.status, typeof data.code === "string" ? data.code : undefined);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Le serveur ne répond pas. Réessayez dans quelques instants.");
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
