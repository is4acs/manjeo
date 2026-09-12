"use client";
import { useEffect, useId, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api, type AddressSuggestion } from "@/lib/api";

// Saisie assistée par le répertoire de démonstration (`/api/addresses`). Le visiteur
// reste libre de taper une adresse absente de la liste : rien n'est imposé.
export default function AddressField({value, city, onChange, onPick, inputProps, ...rest}: {
  value: string; city: string; onChange: (value: string) => void;
  onPick?: (suggestion: AddressSuggestion) => void;
  inputProps?: React.ComponentProps<"input">;
} & Omit<React.ComponentProps<"div">, "onChange">) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const visible = open && suggestions.length > 0;

  useEffect(() => {
    if (!open) return;
    const query = value.trim();
    if (query.length < 2) { setSuggestions([]); setActive(-1); return; }
    const current = ++sequence.current;
    const timer = window.setTimeout(() => {
      void api<{addresses: AddressSuggestion[]}>(`/api/addresses?q=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}`)
        .then(data => { if (current === sequence.current) { setSuggestions(data.addresses); setActive(-1); } })
        .catch(() => { if (current === sequence.current) setSuggestions([]); });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [value, city, open]);

  useEffect(() => {
    if (!visible) return;
    const close = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [visible]);

  function choose(suggestion: AddressSuggestion) {
    onChange(suggestion.label);
    onPick?.(suggestion);
    setOpen(false); setSuggestions([]); setActive(-1);
  }

  function navigate(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { setOpen(false); return; }
    if (!visible) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(current => (current + (event.key === "ArrowDown" ? 1 : suggestions.length) ) % suggestions.length);
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      choose(suggestions[active]);
    }
  }

  return <div className="address-field" ref={box} {...rest}>
    <Input {...inputProps} role="combobox" aria-expanded={visible} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} autoComplete="off"
      value={value} onFocus={() => setOpen(true)} onKeyDown={navigate}
      onChange={event => { onChange(event.target.value); setOpen(true); inputProps?.onChange?.(event); }}/>
    {visible && <ul className="address-list" role="listbox" id={listId} aria-label="Adresses proposées">
      {suggestions.map((suggestion, index) => <li key={suggestion.label + suggestion.city} id={`${listId}-${index}`} role="option"
        aria-selected={index === active} className={index === active ? "active" : ""}>
        <button type="button" onMouseEnter={() => setActive(index)} onClick={() => choose(suggestion)}>
          <MapPin size={16}/><span><strong>{suggestion.label}</strong><small>{suggestion.city}, Guyane française</small></span>
        </button>
      </li>)}
      <li className="address-note">Répertoire de démonstration · {suggestions.length} proposition{suggestions.length > 1 ? "s" : ""}</li>
    </ul>}
  </div>;
}
