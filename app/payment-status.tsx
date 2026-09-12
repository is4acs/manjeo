import { t } from '@/lib/i18n';
import { type Order } from '@/lib/api';

const labels = {
  simulated: 'Simulation sans paiement', awaiting_payment: 'Paiement à terminer', paid: 'Paiement de test confirmé',
  expired: 'Paiement de test expiré', cancelled: 'Paiement abandonné', refund_pending: 'Remboursement de test en attente',
  refunded: 'Remboursement de test confirmé', refund_failed: 'Remboursement à vérifier',
};
export default function PaymentStatus({order}: {order: Order}) {
  if (!order.payment) return null;
  return <div className="payment-status" role="status"><strong>{t(labels[order.payment.status])}</strong>
    {order.payment.status === 'refund_pending' && <p>{t('L’administration doit demander le remboursement dans Stripe. Sa confirmation apparaîtra ici.')}</p>}
    {order.payment.status === 'refund_failed' && <p>{t('L’administration doit vérifier le remboursement dans Stripe.')}</p>}
  </div>;
}
