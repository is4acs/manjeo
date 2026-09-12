import type { FormEvent } from 'react';
import { t } from '@/lib/i18n';
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const messages = new WeakMap<Field,{source:string;params:Record<string,string|number>}>();
function field(target: EventTarget): target is Field { return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement; }
export function setFieldValidity(input:Field,source:string,params:Record<string,string|number>={}) {
  messages.set(input,{source,params}); input.setCustomValidity(t(source,params));
}
export function refreshValidationLanguage() {
  for (const input of document.querySelectorAll('input,select,textarea')) {
    if (!field(input) || !input.validity.customError) continue;
    const saved = messages.get(input);
    if (saved) input.setCustomValidity(t(saved.source,saved.params));
  }
}
export function localizeInvalid(event: FormEvent<HTMLDivElement>) {
  const input = event.target;
  if (!field(input)) return;
  const validity = input.validity;
  if (validity.customError) { const saved = messages.get(input); if (saved) input.setCustomValidity(t(saved.source,saved.params)); return; }
  const number = input as HTMLInputElement;
  if (validity.valueMissing) setFieldValidity(input,'Ce champ est requis.');
  else if (validity.typeMismatch && number.type === 'email') setFieldValidity(input,'Saisissez une adresse e-mail valide.');
  else if (validity.tooShort) setFieldValidity(input,'Saisissez au moins {count} caractères.',{count:number.minLength});
  else if (validity.rangeUnderflow) setFieldValidity(input,'La valeur minimale est {value}.',{value:number.min});
  else if (validity.rangeOverflow) setFieldValidity(input,'La valeur maximale est {value}.',{value:number.max});
  else setFieldValidity(input,'Vérifiez la valeur saisie.');
}
export function clearValidity(event: FormEvent<HTMLDivElement>) { if (field(event.target)) { messages.delete(event.target); event.target.setCustomValidity(''); } }
