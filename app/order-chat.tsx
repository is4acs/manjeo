"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Languages, Phone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type Order, type Thread, type ThreadMessage } from "@/lib/api";
import { languageNames, loadPhrases, phraseIn, translate, type Translation } from "./translate";

const quickReplies: Record<string, string[]> = {
  client: ["downstairs", "cannot_find", "thanks"],
  restaurant: ["order_ready", "running_late", "thanks"],
  courier: ["on_my_way", "at_the_door", "cannot_find", "running_late"],
  admin: [],
};
const time = (value: string) => new Date(value).toLocaleTimeString("fr-FR", {timeZone: "America/Cayenne", hour: "2-digit", minute: "2-digit"});

// Le fil est rattaché à la commande : mêmes participants, même fenêtre de vie.
// Chaque message est conservé dans la langue où il a été écrit et traduit à la lecture.
export default function OrderChat({order, language}: {order: Order; language: string}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [readings, setReadings] = useState<Record<string, Translation | null>>({});
  const [originals, setOriginals] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<Thread>(`/api/orders/${encodeURIComponent(order.id)}/thread`);
      setThread(data); setError("");
    } catch (caught) { setError((caught as Error).message); }
  }, [order.id]);

  useEffect(() => { void loadPhrases().then(() => setReady(true)); }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({block: "nearest"}); }, [thread?.messages.length]);

  // Les messages d'une autre langue passent par le moteur disponible ; les réponses
  // rapides sont rendues depuis le livre de phrases, donc toujours justes.
  useEffect(() => {
    if (!ready || !thread) return;
    let cancelled = false;
    for (const message of thread.messages) {
      if (message.language === language || message.id in readings) continue;
      if (message.phraseId && phraseIn(message.phraseId, language)) {
        setReadings(current => ({...current, [message.id]: {text: phraseIn(message.phraseId, language), engine: "phrases"}}));
        continue;
      }
      void translate(message.body, message.language, language).then(result => {
        if (!cancelled) setReadings(current => ({...current, [message.id]: result}));
      });
    }
    return () => { cancelled = true; };
  }, [thread, language, ready, readings]);

  async function send(payload: {body?: string; phraseId?: string}) {
    if (sending || !thread?.open) return;
    setSending(true); setError("");
    try {
      await api(`/api/orders/${encodeURIComponent(order.id)}/messages`, {method: "POST", body: JSON.stringify(payload)});
      setDraft("");
      await load();
    } catch (caught) { setError((caught as Error).message); }
    finally { setSending(false); }
  }

  function rendered(message: ThreadMessage) {
    const reading = readings[message.id];
    const showOriginal = originals[message.id] || message.language === language || !reading;
    return <>
      <p>{showOriginal ? message.body : reading!.text}</p>
      {message.language !== language && <span className="chat-origin">
        {reading
          ? <>{showOriginal ? `Écrit en ${languageNames[message.language] || message.language}` : `Traduit du ${languageNames[message.language] || message.language}`}
              <button type="button" onClick={() => setOriginals(current => ({...current, [message.id]: !showOriginal}))}>{showOriginal ? "Traduire" : "Voir l’original"}</button></>
          : <>Écrit en {languageNames[message.language] || message.language} — aucune traduction disponible sur cet appareil</>}
      </span>}
    </>;
  }

  if (!thread) return <div className="order-chat"><p className="chat-empty">{error || "Ouverture de la conversation…"}</p></div>;
  const replies = quickReplies[thread.viewerRole] || [];
  return <div className="order-chat">
    {thread.contacts.length > 0 && <ul className="chat-contacts">{thread.contacts.map(contact => <li key={contact.role}>
      <span><strong>{contact.label} · {contact.name}</strong><small>{contact.note}</small>
        {contact.language !== language && <small>Parle {languageNames[contact.language] || contact.language} — vos messages sont traduits.</small>}</span>
      {contact.phone
        ? <a className="chat-call" href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}><Phone size={16}/>Appeler</a>
        : <small className="chat-closed">Numéro ouvert pendant la livraison</small>}
    </li>)}</ul>}

    <div className="chat-messages" role="log" aria-label="Messages de la commande">
      {thread.messages.length === 0 && <p className="chat-empty">Aucun message. Écrivez ou choisissez une réponse rapide.</p>}
      {thread.messages.map(message => <div key={message.id} className={`chat-message ${message.senderRole === thread.viewerRole ? "mine" : ""}`}>
        <span className="chat-author">{message.senderName}<small>{time(message.date)}</small></span>
        {rendered(message)}
      </div>)}
      <div ref={bottom}/>
    </div>

    {error && <p className="checkout-error" role="alert">{error}</p>}
    {thread.open ? <>
      {replies.length > 0 && <div className="chat-replies">{replies.map(phraseId => <button key={phraseId} type="button" disabled={sending}
        onClick={() => void send({phraseId})}>{phraseIn(phraseId, language) || "…"}</button>)}</div>}
      <form className="chat-form" onSubmit={event => { event.preventDefault(); if (draft.trim()) void send({body: draft.trim()}); }}>
        <label className="sr-only" htmlFor={`chat-${order.id}`}>Votre message</label>
        <input id={`chat-${order.id}`} value={draft} maxLength={600} disabled={sending} placeholder="Écrivez dans votre langue…"
          onChange={event => setDraft(event.target.value)}/>
        <Button type="submit" variant="punch" size="icon" disabled={sending || !draft.trim()} aria-label="Envoyer"><Send size={18}/></Button>
      </form>
      <p className="chat-note"><Languages size={14}/>Vous écrivez en {languageNames[language] || language} ; chacun lit dans sa langue quand un moteur est disponible.</p>
    </> : <p className="chat-note">Conversation close : elle s’ouvre à l’acceptation de la commande et se ferme après la livraison.</p>}
  </div>;
}
