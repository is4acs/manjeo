import { t } from "@/lib/i18n";
import { Clock3, CreditCard, MapPin } from "lucide-react";
import "./reassurance.css";

/** Bandeau de réassurance. La troisième colonne dit ce que la démonstration fait vraiment :
 * aucun encaissement réel, donc aucune promesse de paiement à la livraison. */
export default function Reassurance({count}: {count: number}) {
  const items = [
    {Icon: Clock3, title: "Suivi en direct", line: "Vous voyez où en est votre commande, étape par étape."},
    {Icon: MapPin, title: "Cuisiné à Cayenne", line: "{count} tables du centre, de Rémire et de Matoury."},
    {Icon: CreditCard, title: "Paiement de démonstration", line: "Aucun encaissement réel : le paiement reste en mode test."},
  ];
  return <section className="reassurance" aria-label={t("Ce que fait cette démonstration")}>
    {items.map(({Icon, title, line}) => <div className="reassurance-item" key={title}>
      <span className="reassurance-badge"><Icon size={21}/></span>
      <div><strong>{t(title)}</strong><span>{t(line, {count})}</span></div>
    </div>)}
  </section>;
}
