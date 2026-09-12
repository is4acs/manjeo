import { useEffect, useRef, useState } from 'react';
import { Check, MapPin, Search } from 'lucide-react';
import { api, type AddressCandidate, type DeliveryAddress } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import './customer-account.css';

export function savedAddressMatches(saved: DeliveryAddress | null | undefined, address: string, city: string, now = Date.now()) {
  return !!saved && saved.address === address.trim() && saved.city === city && Date.parse(saved.verificationExpiresAt) > now;
}

export default function AddressVerification({userId, address, city, saved, selected, onSelect, disabled = false}: {
  userId?: string; address: string; city: string; saved?: DeliveryAddress | null;
  selected: AddressCandidate | null; onSelect: (candidate: AddressCandidate) => void; disabled?: boolean;
}) {
  const [candidates, setCandidates] = useState<AddressCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);
  const identity = `${userId || ''}\n${address}\n${city}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const generation = useRef(0);
  useEffect(() => { ++generation.current; setCandidates([]); setError(''); setBusy(false); }, [identity]);
  useEffect(() => () => { ++generation.current; }, []);
  const selectedMatches = selected?.address === address.trim() && selected.city === city;
  const savedMatches = saved?.address === address.trim() && saved.city === city;
  const expiryKey = JSON.stringify([selectedMatches ? selected.expiresAt : '', savedMatches ? saved.verificationExpiresAt : '', ...candidates.map(candidate => candidate.expiresAt)]);
  useEffect(() => {
    const deadlines: number[] = JSON.parse(expiryKey).map((value: string) => Date.parse(value)).filter(Number.isFinite);
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const current = Date.now(); setNow(current);
      const next = Math.min(...deadlines.filter(deadline => deadline > current));
      if (Number.isFinite(next)) timer = setTimeout(update, Math.min(next - current + 1, 2_147_483_647));
    };
    update();
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [expiryKey]);
  const confirmed = selectedMatches && Date.parse(selected.expiresAt) > now ? selected : savedAddressMatches(saved, address, city, now) ? saved : null;
  const validCandidates = candidates.filter(candidate => Date.parse(candidate.expiresAt) > now);
  const expired = !confirmed && (selectedMatches || savedMatches || candidates.length > validCandidates.length);
  async function verify() {
    if (!userId || busy || disabled) return;
    const sequence = ++generation.current;
    setBusy(true); setError(''); setCandidates([]);
    try {
      const result = await api<{candidates: AddressCandidate[]}>('/api/addresses/verify', {method: 'POST', accountId:userId, body: JSON.stringify({address: address.trim(), city})});
      if (sequence !== generation.current || currentIdentity.current !== identity) return;
      setCandidates(result.candidates);
      if (!result.candidates.length) setError('Aucun point trouvé. Précisez le numéro et le nom de la rue.');
    } catch (cause) { if (sequence === generation.current && currentIdentity.current === identity) setError((cause as Error).message); }
    finally { if (sequence === generation.current && currentIdentity.current === identity) setBusy(false); }
  }
  return <div className="address-verification">
    {confirmed ? <div className="verified-address" role="status"><Check size={19}/><div><strong>{t('Point de livraison confirmé')}</strong><p>{confirmed.address}, {confirmed.city}</p><small>{t('Coordonnées issues de l’IGN. Vérifiez que le point correspond à votre entrée.')}</small><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${confirmed.latitude},${confirmed.longitude}`)}`} target="_blank" rel="noopener noreferrer">{t('Voir le point sur Google Maps')}</a></div></div> : <>
      <p>{t('Recherchez votre adresse, vérifiez le point sur la carte, puis confirmez votre lieu de livraison.')}</p>
      <Button type="button" variant="outline" disabled={disabled || busy || !userId || address.trim().length < 5} onClick={() => void verify()}><Search size={17}/>{t(busy ? 'Recherche du point…' : 'Vérifier mon adresse')}</Button>
      {!userId && <small>{t('Connectez-vous pour vérifier et enregistrer votre adresse.')}</small>}
    </>}
    {error && <p className="checkout-error" role="alert">{t(error)}</p>}
    {expired && !busy && <p role="status">{t('La vérification de cette adresse a expiré. Recherchez et confirmez à nouveau votre point de livraison.')}</p>}
    {!!validCandidates.length && !confirmed && <ul className="address-candidates">{validCandidates.map(candidate => <li key={candidate.verificationToken}><MapPin size={19}/><div><strong>{candidate.address}</strong><p>{candidate.city}</p>{candidate.precision === 'street' && <small>{t('Point situé dans la rue : ajoutez le numéro et un repère dans les précisions.')}</small>}<a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${candidate.latitude},${candidate.longitude}`)}`} target="_blank" rel="noopener noreferrer">{t('Voir le point sur Google Maps')}</a><Button type="button" disabled={disabled} onClick={() => { if (Date.parse(candidate.expiresAt) > Date.now()) onSelect(candidate); else setNow(Date.now()); }}>{t('Confirmer ce point de livraison')}</Button></div></li>)}</ul>}
  </div>;
}
