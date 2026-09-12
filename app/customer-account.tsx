import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api, type AddressCandidate, type User, type PaymentMethod, type PaymentConfig } from '@/lib/api';
import { getLanguage, t } from '@/lib/i18n';
import AddressField from './address-field';
import PaymentMethods from './payment-methods';
import AddressVerification, { savedAddressMatches } from './address-verification';

export default function CustomerAccount({user, disabled, onSaveProfile}: {user: User; disabled: boolean; onSaveProfile: (payload: Record<string, unknown>) => Promise<User>}) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone || '');
  const [address, setAddress] = useState(user.deliveryAddress?.address || '');
  const [city, setCity] = useState(user.deliveryAddress?.city || 'Cayenne');
  const [details, setDetails] = useState(user.deliveryAddress?.details || '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(user.paymentMethod || 'demo');
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  useEffect(() => { let alive = true; void api<PaymentConfig>('/api/payments/config').then(value => {if (alive) setPaymentConfig(value);}).catch(() => {if (alive) setPaymentConfig({mode:'demo', stripeAvailable:false, reason:'Le paiement Stripe de test n’est pas configuré. La démonstration reste disponible.'});}); return () => {alive = false;}; }, []);
  const [candidate, setCandidate] = useState<AddressCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const saving = useRef(false);
  useEffect(() => {mounted.current = true; return () => { mounted.current = false; };}, []);
  const confirmed = candidate?.address === address.trim() && candidate.city === city && Date.parse(candidate.expiresAt) > Date.now() ? candidate : null;
  const saved = savedAddressMatches(user.deliveryAddress, address, city);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current || disabled) return;
    if (address.trim() && !confirmed && !saved) { setError('Confirmez le point de livraison avant d’enregistrer cette adresse.'); return; }
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const payload: Record<string, unknown> = {name: name.trim(), phone: phone.trim(), language: getLanguage(), paymentMethod};
      // Leaving the field empty explicitly removes a previously saved address.
      payload.deliveryAddress = !address.trim() ? null : {address: address.trim(), city, details: details.trim(), ...(confirmed ? {verificationToken: confirmed.verificationToken} : {})};
      const updated = await onSaveProfile(payload);
      if (!mounted.current || updated.id !== user.id) return; setCandidate(null); setNotice('Vos coordonnées sont enregistrées.');
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  return <form className="account-form customer-profile-form" onSubmit={save}><fieldset disabled={disabled || busy} className="profile-fields">
    <label>{t('Prénom et nom')}<Input value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={100} autoComplete="name"/></label>
    <label>{t('Téléphone')}<Input value={phone} onChange={event => setPhone(event.target.value)} type="tel" maxLength={30} autoComplete="tel" placeholder="0694 00 00 00"/></label>
    <h2>{t('Mon adresse habituelle')}</h2>
    <label>{t('Rue et numéro')}<AddressField value={address} city={city} onChange={value => {setAddress(value); setCandidate(null);}} onPick={value => {setCity(value.city); setCandidate(null);}} inputProps={{maxLength: 180, autoComplete: 'street-address'}}/></label>
    <label>{t('Commune')}<select value={city} onChange={event => {setCity(event.target.value); setCandidate(null);}}>{['Cayenne', 'Rémire-Montjoly', 'Matoury'].map(item => <option key={item}>{item}</option>)}</select></label>
    <label>{t('Bâtiment, étage (facultatif)')}<Input value={details} onChange={event => setDetails(event.target.value)} maxLength={300}/></label>
    <AddressVerification userId={user.id} address={address} city={city} saved={user.deliveryAddress} selected={candidate} disabled={disabled || busy} onSelect={value => {setCandidate(value); setAddress(value.address); setCity(value.city);}}/>
    <h2>{t('Mon moyen de paiement')}</h2><PaymentMethods value={paymentMethod} onChange={setPaymentMethod} config={paymentConfig} disabled={disabled || busy}/>
    <small>{t('Le nom, le téléphone et l’adresse confirmée seront proposés pour commander en un clic depuis votre panier.')}</small>
    {error && <p className="account-error" role="alert">{t(error)}</p>}{notice && <p className="account-notice" role="status">{t(notice)}</p>}
    <Button type="submit" disabled={disabled || busy}>{t(busy ? 'Enregistrement…' : 'Enregistrer mes coordonnées')}</Button>
  </fieldset></form>;
}
