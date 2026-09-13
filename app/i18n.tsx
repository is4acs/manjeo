import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { getLanguage, languageOptions, normalizeLanguage, setLanguageValue, subscribeLanguage, type UILanguage } from '@/lib/i18n';
import './i18n.css';

const storageKey = 'manjeo-language-v1';
const cookieKey = 'manjeo-locale';
const selectorLabel = 'Langue / Lang / Idioma';
let explicitChoice = false;
let listeningToStorage = false;

function savedLanguage() {
  try { const value = normalizeLanguage(localStorage.getItem(storageKey)); if (value) return value; } catch {}
  try { return normalizeLanguage(document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(cookieKey + '='))?.slice(cookieKey.length + 1)); } catch { return null; }
}
function persistLanguage(value: UILanguage) {
  try { localStorage.setItem(storageKey, value); } catch {}
  try { document.cookie = `${cookieKey}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch {}
}
export function initializeLanguage() {
  let selected: UILanguage | null = null;
  try { selected = normalizeLanguage(new URL(location.href).searchParams.get('lang')); } catch {}
  selected ||= savedLanguage();
  explicitChoice = !!selected;
  if (!selected) {
    try { selected = [...(navigator.languages || []), navigator.language].map(normalizeLanguage).find(Boolean) || 'fr'; } catch { selected = 'fr'; }
  }
  setLanguageValue(selected);
  if (explicitChoice) persistLanguage(selected);
  if (!listeningToStorage && typeof window !== 'undefined') {
    window.addEventListener('storage', event => {
      if (event.key !== storageKey) return;
      const value = normalizeLanguage(event.newValue);
      if (value) chooseLanguage(value);
    });
    listeningToStorage = true;
  }
}
export function useLanguage() { return useSyncExternalStore(subscribeLanguage, getLanguage, () => 'fr' as const); }
export function hasLanguageChoice() { return explicitChoice; }
export function chooseLanguage(value: UILanguage) {
  const supported = normalizeLanguage(value);
  if (!supported) return;
  explicitChoice = true; setLanguageValue(supported);
  persistLanguage(supported);
  // A shared language URL must not undo a later choice on refresh.
  try { const url = new URL(location.href); if (url.searchParams.has('lang')) { url.searchParams.set('lang',supported); history.replaceState(history.state,'',url); } } catch {}
}
export function adoptProfileLanguage(value: string) {
  const supported = normalizeLanguage(value);
  if (!explicitChoice && supported) setLanguageValue(supported);
}

function LanguageFlag({language}: {language: UILanguage}) {
  return <span className="language-flag" aria-hidden="true"><svg viewBox="0 0 3 2" preserveAspectRatio="xMidYMid slice" focusable="false">
    {language === 'fr' ? <><rect width="1" height="2" x="0" fill="#0055A4"/><rect width="1" height="2" x="1" fill="#FFFFFF"/><rect width="1" height="2" x="2" fill="#EF4135"/></>
      : language === 'pt' ? <><rect width="3" height="2" fill="#009C3B"/><path d="M1.5 0.2 2.8 1 1.5 1.8 0.2 1Z" fill="#FFDF00"/><circle cx="1.5" cy="1" r="0.45" fill="#002776"/><path d="M1.08 0.93a0.9 0.9 0 0 1 0.84 0.28" stroke="#FFFFFF" strokeWidth="0.09" fill="none"/></>
      : <><rect width="3" height="1" y="0" fill="#00209F"/><rect width="3" height="1" y="1" fill="#D21034"/><rect x="1.05" y="0.62" width="0.9" height="0.76" fill="#FFFFFF"/><rect x="1.32" y="0.86" width="0.36" height="0.28" fill="#016A16"/></>}
  </svg></span>;
}
export function LanguageBar({onChange, disabled = false}: {onChange:(value:UILanguage)=>void; disabled?:boolean}) {
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const selected = languageOptions.find(option => option.code === language)!;
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div className="language-selector">
    <DropdownMenu.Root modal={false} open={open} onOpenChange={value => { if (!disabled) setOpen(value); }}>
      <DropdownMenu.Trigger asChild><button className="language-trigger" type="button" disabled={disabled} aria-label={`${selectorLabel} : ${selected.label}`}><LanguageFlag language={language}/><span className="language-code" aria-hidden="true">{selected.code.toUpperCase()}</span><ChevronDown size={16} aria-hidden="true"/></button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="language-menu" side="bottom" align="end" sideOffset={8} collisionPadding={12} aria-label={selectorLabel}>
        <DropdownMenu.Label className="language-heading">{selectorLabel}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={language} onValueChange={value => { const supported = normalizeLanguage(value); if (supported && !disabled) onChange(supported); }}>
          {languageOptions.map(option => <DropdownMenu.RadioItem className="language-option" key={option.code} value={option.code} lang={option.tag}><LanguageFlag language={option.code}/><span>{option.label}</span><DropdownMenu.ItemIndicator className="language-selected"><Check size={17} aria-hidden="true"/></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>;
}
