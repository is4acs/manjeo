import { t } from "@/lib/i18n";
import { money } from "@/lib/menu";
import type { PublicPromotion } from "@/lib/api";
import "./deal-card.css";

const tones = ["deal-punch", "deal-outline", "deal-ink"];

/** Une carte par code réellement ouvert : le libellé et les conditions viennent du serveur. */
export default function DealCard({promotion, tone, restaurant, applied, onUse}: {
  promotion: PublicPromotion; tone: number; restaurant: string; applied: boolean; onUse: () => void;
}) {
  const period = restaurant || (promotion.minimum ? t("Dès {price}", {price: money(promotion.minimum)}) : t("Tous les jours"));
  const conditions = promotion.conditions.split(" · ").filter(Boolean).map(part => t(part)).join(" · ");
  return <article className={`deal-card ${tones[tone % tones.length]}`}>
    <span className="deal-period">{period}</span>
    <h3>{t(promotion.label)}</h3>
    <p>{conditions || t("Valable sur toute la carte.")}</p>
    <button type="button" className="deal-action" onClick={onUse} aria-label={t("Utiliser le code {code}", {code: promotion.code})}>
      {applied ? t("Code appliqué") : t("J’en profite")}
    </button>
  </article>;
}
