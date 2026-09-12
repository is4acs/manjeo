import { Component, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

/** A failed deferred module must leave a usable route back to the shop. */
export default class RouteBoundary extends Component<{children: ReactNode; onShop: () => void}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app-startup"><span className="brand">manjéo</span><div className="startup-card" role="alert">
      <RefreshCw size={30}/><h1>{t('Votre espace est momentanément indisponible.')}</h1>
      <p>{t('Vérifiez votre connexion, puis rechargez la page pour rouvrir votre espace.')}</p>
      <Button onClick={() => window.location.reload()}>{t('Recharger la page')}</Button>
      <Button variant="outline" onClick={this.props.onShop}>{t('Retour aux restaurants')}</Button>
    </div></main>;
  }
}
