import { useSyncExternalStore } from 'react';
import { Languages } from 'lucide-react';
import { getLanguage, languageOptions, normalizeLanguage, setLanguageValue, subscribeLanguage, type UILanguage } from '@/lib/i18n';
const storageKey = 'manjeo-language-v1';
let explicitChoice = false;
export function initializeLanguage() {
  let selected: UILanguage | null = null;
  try { selected = normalizeLanguage(new URL(location.href).searchParams.get('lang')) || normalizeLanguage(localStorage.getItem(storageKey)); } catch {}
  explicitChoice = !!selected;
  if (!selected) selected = navigator.languages.map(normalizeLanguage).find(Boolean) || 'fr';
  setLanguageValue(selected);
  if (explicitChoice) { try { localStorage.setItem(storageKey,selected); } catch {} }
}
export function useLanguage() { return useSyncExternalStore(subscribeLanguage, getLanguage, () => 'fr' as const); }
export function hasLanguageChoice() { return explicitChoice; }
export function chooseLanguage(value: UILanguage) {
  explicitChoice = true; setLanguageValue(value);
  try { localStorage.setItem(storageKey,value); } catch {}
  // A shared language URL must not undo a later choice on refresh.
  try { const url = new URL(location.href); if (url.searchParams.has('lang')) { url.searchParams.set('lang',value); history.replaceState(history.state,'',url); } } catch {}
}
export function adoptProfileLanguage(value: string) {
  const supported = normalizeLanguage(value);
  if (!explicitChoice && supported) setLanguageValue(supported);
}
export function LanguageBar({onChange, disabled = false}: {onChange:(value:UILanguage)=>void; disabled?:boolean}) {
  const language = useLanguage();
  return <div className="language-bar"><label><Languages size={16}/><span>Langue · Lang · Idioma</span><select aria-label="Langue / Lang / Idioma" value={language} disabled={disabled} onChange={event => onChange(event.target.value as UILanguage)}>{languageOptions.map(option => <option key={option.code} value={option.code} lang={option.tag}>{option.label}</option>)}</select></label></div>;
}
