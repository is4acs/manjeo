import { commonTranslations } from './locales/common.ts';
import { clientTranslations } from './locales/client.ts';
import { staffTranslations } from './locales/staff.ts';
import { catalogTranslations } from './locales/catalog.ts';
import { errorTranslations } from './locales/errors.ts';
import { customerTranslations } from './locales/customer.ts';
export type UILanguage = 'fr' | 'ht' | 'pt';
export type Translations = Record<string, [string, string]>;
export const translations: Translations = {...commonTranslations, ...errorTranslations, ...catalogTranslations, ...staffTranslations, ...clientTranslations, ...customerTranslations};
export const languageOptions: {code: UILanguage; label: string; tag: string}[] = [
  {code:'fr', label:'Français', tag:'fr'}, {code:'ht', label:'Kreyòl ayisyen', tag:'ht'}, {code:'pt', label:'Português (Brasil)', tag:'pt-BR'},
];
let language: UILanguage = 'fr';
export function normalizeLanguage(value: unknown): UILanguage | null {
  if (typeof value !== 'string') return null;
  const base = value.toLowerCase().split(/[-_]/)[0];
  return base === 'fr' || base === 'ht' || base === 'pt' ? base : null;
}
export function getLanguage() { return language; }
const listeners = new Set<() => void>();
export function subscribeLanguage(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setLanguageValue(value: UILanguage) { if (language !== value) { language = value; for (const listener of listeners) listener(); } }
export function localeTag(value: UILanguage = language) { return value === 'pt' ? 'pt-BR' : value === 'ht' ? 'fr-HT' : 'fr-FR'; }
export function documentLanguage(value: UILanguage = language) { return value === 'pt' ? 'pt-BR' : value; }
const interpolate = (value: string, params: Record<string, string | number>) => value.replace(/\{(\w+)\}/g, (match, key: string) => key in params ? String(params[key]) : match);
const patterns = Object.keys(translations).filter(key => /\{\w+\}/.test(key)).sort((a,b) => b.replace(/\{\w+\}/g,'').length - a.replace(/\{\w+\}/g,'').length).map(key => {
  const names: string[] = [];
  const escaped = key.split(/(\{\w+\})/).map(part => /^\{\w+\}$/.test(part) ? (names.push(part.slice(1,-1)), '(.+?)') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return {key, names, expression: new RegExp(`^${escaped}$`, 's')};
});
/** Translate authored interface copy only. Never pass message bodies, names or addresses here. */
export function t(source: string, params: Record<string, string | number> = {}, target: UILanguage = language): string {
  if (target === 'fr') return interpolate(source, params);
  const direct = Object.hasOwn(translations,source) ? translations[source] : undefined;
  if (direct) return interpolate(direct[target === 'ht' ? 0 : 1], params);
  // Server errors and persisted system events carry their interpolated French text.
  for (const pattern of patterns) {
    const match = pattern.expression.exec(source);
    if (match) return interpolate(translations[pattern.key][target === 'ht' ? 0 : 1], Object.fromEntries(pattern.names.map((name,index) => [name,match[index+1]])));
  }
  return interpolate(source, params);
}
export function tEvent(label: string) { return t(label); }
const months = ['janvye','fevriye','mas','avril','me','jen','jiyè','out','septanm','oktòb','novanm','desanm'];
const shortMonths = ['janv.','fev.','mas','avr.','me','jen','jiyè','out','sept.','okt.','nov.','des.'];
const weekdays = ['dimanch','lendi','madi','mèkredi','jedi','vandredi','samdi'];
export function formatDate(value: string, options: Intl.DateTimeFormatOptions = {}): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t('Horaire indisponible');
  const settings = {timeZone:'America/Cayenne', ...options};
  const formatter = new Intl.DateTimeFormat(localeTag(), settings);
  if (language !== 'ht') return formatter.format(date);
  const calendar = new Intl.DateTimeFormat('en-US', {timeZone:settings.timeZone,month:'numeric',weekday:'long'}).formatToParts(date);
  const month = Number(calendar.find(part => part.type === 'month')?.value) - 1;
  const day = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(calendar.find(part => part.type === 'weekday')?.value || '');
  return formatter.formatToParts(date).map(part => {
    if (part.type === 'month' && options.month === 'long') return months[month];
    if (part.type === 'month' && options.month === 'short') return shortMonths[month];
    if (part.type === 'weekday' && day >= 0) return options.weekday === 'long' ? weekdays[day] : weekdays[day].slice(0,3);
    return part.value;
  }).join('');
}
