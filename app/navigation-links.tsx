import { ArrowUpRight, Navigation } from 'lucide-react';
import { t } from '@/lib/i18n';
import { navigationLinks, type NavigationDestination } from '@/lib/navigation';
import './navigation-links.css';

export function NavigationLinks({destination, variant = 'full'}: {destination: NavigationDestination; variant?: 'full' | 'compact'}) {
  const links = navigationLinks(destination);
  if (!links) return null;
  const apps = [{name: 'Google Maps', href: links.googleMaps}, {name: 'Waze', href: links.waze}, {name: t('Plans (Apple)'), href: links.appleMaps}];
  return <div className={`navigation-links navigation-links-${variant}`}>
    <p className={`navigation-label${variant === 'compact' ? ' sr-only' : ''}`}><Navigation size={16} aria-hidden="true"/><strong>{t('Ouvrir l’itinéraire')}</strong></p>
    <div className="navigation-links-list">{apps.map(app => <a key={app.href} className="navigation-link" href={app.href} target="_blank" rel="noopener noreferrer" aria-label={t('Ouvrir l’itinéraire avec {app}', {app: app.name})}>{app.name}<ArrowUpRight size={14} aria-hidden="true"/></a>)}</div>
    <p className="navigation-note">{links.usesCoordinates ? t('Destination à partir des coordonnées enregistrées.') : t('Adresse à vérifier dans l’application de navigation.')}</p>
  </div>;
}
