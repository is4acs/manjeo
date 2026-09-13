import { t } from "@/lib/i18n";
import type { Promo } from "@/lib/menu";
import "./offer-flag.css";

/** L’offre est toujours écrite au même endroit : drapeau sur les photos, pastille sur les lignes.
 * Le libellé vient du catalogue et n’est jamais composé par la page. */
export default function OfferFlag({promo, variant = "flag"}: {promo: Promo; variant?: "flag" | "pill"}) {
  return <span className={variant === "flag" ? "offer-flag" : "offer-pill"}>{t(promo.label)}</span>;
}
