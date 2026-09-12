"use client";
import { t } from "@/lib/i18n";
import { useEffect, useId, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api, type AddressSuggestion } from "@/lib/api";

// Suggestions are optional. Only an explicit click or keyboard selection changes the address.
export default function AddressField({value, city, onChange, onPick, inputProps, className, ...rest}: {
  value: string; city: string; onChange: (value: string) => void;
  onPick?: (suggestion: AddressSuggestion) => void;
  inputProps?: React.ComponentProps<"input">;
} & Omit<React.ComponentProps<"div">, "onChange">) {
  const [result, setResult] = useState<{key: string; addresses: AddressSuggestion[]; source?: string; note?: string}>({key: "", addresses: []});
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const query = value.trim();
  const queryKey = JSON.stringify([query, city]);
  const disabled = !!inputProps?.disabled || !!inputProps?.readOnly;
  const suggestions = result.key === queryKey ? result.addresses : [];
  const visible = !disabled && open && query.length >= 2 && suggestions.length > 0;

  useEffect(() => {
    const current = ++sequence.current;
    setActive(-1);
    if (!open || disabled || query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api<{addresses: AddressSuggestion[]; source?: string; note?: string}>(`/api/addresses?q=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}`, {signal: controller.signal})
        .then(data => { if (current === sequence.current && !controller.signal.aborted) setResult({key: queryKey, addresses: data.addresses, source: data.source, note: data.note}); })
        .catch(() => { if (current === sequence.current && !controller.signal.aborted) setResult({key: queryKey, addresses: []}); });
    }, 180);
    return () => { ++sequence.current; window.clearTimeout(timer); controller.abort(); };
  }, [query, queryKey, city, open, disabled]);

  function close() { ++sequence.current; setOpen(false); setActive(-1); }
  function choose(suggestion: AddressSuggestion) {
    if (disabled || !visible) return;
    close(); setResult({key: "", addresses: []});
    onChange(suggestion.label);
    onPick?.(suggestion);
  }
  function navigate(event: React.KeyboardEvent<HTMLInputElement>) {
    inputProps?.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!visible) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(current => event.key === "ArrowDown" ? (current + 1) % suggestions.length : current <= 0 ? suggestions.length - 1 : current - 1);
    } else if (event.key === "Enter" && active >= 0 && active < suggestions.length) {
      event.preventDefault(); choose(suggestions[active]);
    }
  }
  return <div className={`address-field${className ? ` ${className}` : ""}`} ref={box} {...rest}>
    <Input {...inputProps} role="combobox" aria-expanded={visible} aria-controls={visible ? listId : undefined} aria-autocomplete="list"
      aria-activedescendant={visible && active >= 0 && active < suggestions.length ? `${listId}-${active}` : undefined} autoComplete="off"
      value={value} onFocus={event => { inputProps?.onFocus?.(event); if (!disabled) setOpen(true); }} onKeyDown={navigate}
      onBlur={event => { inputProps?.onBlur?.(event); if (!box.current?.contains(event.relatedTarget as Node | null)) close(); }}
      onChange={event => { ++sequence.current; setActive(-1); setResult({key: "", addresses: []}); onChange(event.target.value); setOpen(true); inputProps?.onChange?.(event); }}/>
    {!disabled && open && query.length >= 2 && result.key === queryKey && !suggestions.length && <p className="address-note" role="status">{t(result.note || "Aucune suggestion pour cette saisie. Vous pouvez écrire votre adresse librement.")}</p>}
    {visible && <ul className="address-list" role="listbox" id={listId} aria-label={t("Adresses proposées")}>
      {suggestions.map((suggestion, index) => <li key={suggestion.label + suggestion.city} id={`${listId}-${index}`} role="option"
        aria-selected={index === active} className={index === active ? "active" : ""}>
        <button type="button" tabIndex={-1} onPointerDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(suggestion)}>
          <MapPin size={16}/><span><strong>{suggestion.label}</strong><small>{t("{city}, Guyane française", {city: suggestion.city})}</small></span>
        </button>
      </li>)}
      <li className="address-note" role="presentation">{t(suggestions.length > 1 ? "{source} · {count} propositions" : "{source} · {count} proposition", {source: t(result.source === "ign" ? "Suggestions IGN" : "Répertoire de démonstration"), count: suggestions.length})}{result.note && <span> · {t(result.note)}</span>}</li>
    </ul>}
  </div>;
}
