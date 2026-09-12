import { type PaymentConfig, type PaymentMethod } from '@/lib/api';
import { t } from '@/lib/i18n';

export default function PaymentMethods({value, onChange, config, disabled}: {value: PaymentMethod; onChange: (method: PaymentMethod) => void; config: PaymentConfig | null; disabled?: boolean}) {
  return <div className="payment-methods">
    <label><input type="radio" name="paymentMethod" value="demo" checked={value === 'demo'} disabled={disabled} onChange={() => onChange('demo')}/><span><strong>{t('Simulation sans paiement')}</strong><small>{t('Aucune carte bancaire requise. Aucun débit.')}</small></span></label>
    <label><input type="radio" name="paymentMethod" value="stripe" checked={value === 'stripe'} disabled={disabled || !config?.stripeAvailable} onChange={() => onChange('stripe')}/><span><strong>{t('Carte bancaire · Apple Pay · Google Pay')}</strong><small>{t('Paiement Stripe en mode test. Les portefeuilles proposés dépendent de votre appareil et de Stripe.')}</small>{!config?.stripeAvailable && <small>{t(config?.reason || 'Vérification de la disponibilité des paiements…')}</small>}</span></label>
  </div>;
}
