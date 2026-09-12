"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Languages, Phone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError, type Order, type Thread, type ThreadMessage } from "@/lib/api";
import { canEnableBrowserTranslation, enableBrowserTranslation, languageNames, loadPhrases, phraseIn, translate, type Translation } from "./translate";

const quickReplies: Record<string, string[]> = {
  client: ["downstairs", "cannot_find", "thanks"],
  restaurant: ["order_ready", "running_late", "thanks"],
  courier: ["on_my_way", "at_the_door", "cannot_find", "running_late"],
  admin: ["thanks"],
};
const time = (value: string) => new Date(value).toLocaleTimeString("fr-FR", {timeZone: "America/Cayenne", hour: "2-digit", minute: "2-digit"});

export default function OrderChat({order, language, viewerId}: {order: Order; language: string; viewerId: string}) {
  const context = `${viewerId}:${order.id}`;
  const currentContext = useRef(context); currentContext.current = context;
  const accessContext = `${context}:${order.status}:${order.courierId || ""}`;
  const currentAccess = useRef(accessContext); currentAccess.current = accessContext;
  const [loaded, setLoaded] = useState<{context: string; access: string; value: Thread} | null>(null);
  const thread = loaded?.context === context && loaded.access === accessContext ? loaded.value : null;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [readings, setReadings] = useState<{key: string; values: Record<string, Translation | null>}>({key: "", values: {}});
  const [originals, setOriginals] = useState<Record<string, boolean>>({});
  const [phrasesReady, setPhrasesReady] = useState(false);
  const [retryTranslation, setRetryTranslation] = useState(0);
  const [activation, setActivation] = useState<{context: string; busy: boolean; notice: string} | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const fetching = useRef<AbortController | null>(null);
  const posting = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const request = useRef({key: "", id: ""});

  const load = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    const version = ++sequence.current;
    fetching.current?.abort();
    const controller = new AbortController(); fetching.current = controller;
    try {
      const data = await api<Thread>(`/api/orders/${encodeURIComponent(order.id)}/thread`, {signal: controller.signal});
      if (!mounted.current || controller.signal.aborted || currentAccess.current !== accessContext || sequence.current !== version) return;
      if (data.viewerId !== viewerId) { setLoaded(null); setError("Le compte connecté a changé. Rouvrez la conversation."); return; }
      setLoaded({context, access: accessContext, value: data}); setError("");
      window.dispatchEvent(new CustomEvent("manjeo-thread-read", {detail: {orderId: order.id, viewerId}}));
    } catch (caught) {
      if (!mounted.current || controller.signal.aborted || currentAccess.current !== accessContext || sequence.current !== version) return;
      // Revocation must remove old phone numbers and messages immediately.
      if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) setLoaded(null);
      setError(caught instanceof Error ? caught.message : "La conversation est indisponible.");
    }
  }, [context, accessContext, order.id, viewerId]);

  useEffect(() => {
    mounted.current = true; setLoaded(null); setDraft(""); setError(""); setSending(false);
    setOriginals({}); sendingRef.current = false; request.current = {key: "", id: ""};
    return () => {
      mounted.current = false; ++sequence.current;
      fetching.current?.abort(); posting.current?.abort();
    };
  }, [context]);
  useEffect(() => {
    void load();
    void loadPhrases().then(data => { if (mounted.current && currentContext.current === context) setPhrasesReady(Object.keys(data).length > 0); });
    const refresh = () => { if (!sendingRef.current) void load(); };
    const timer = window.setInterval(refresh, 8000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      ++sequence.current; fetching.current?.abort();
      window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh);
    };
  }, [context, load]);
  useEffect(() => { bottom.current?.scrollIntoView({block: "nearest"}); }, [thread?.messages.length]);

  const translationContext = `${context}:${language}`;
  const currentTranslationContext = useRef(translationContext); currentTranslationContext.current = translationContext;
  const messageSignature = JSON.stringify(thread?.messages.map(message => [message.id, message.body, message.language, message.phraseId]) || []);
  useEffect(() => {
    const controller = new AbortController();
    const messages = thread?.messages || [];
    setReadings({key: translationContext, values: {}}); setOriginals({});
    const queue = messages.filter(message => message.language !== language);
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const message = queue.shift()!;
        const prepared = message.phraseId ? phraseIn(message.phraseId, language) : "";
        const result = prepared ? {text: prepared, engine: "phrases" as const} : await translate(message.body, message.language, language, viewerId, controller.signal);
        if (!controller.signal.aborted && mounted.current && currentContext.current === context) {
          setReadings(current => current.key === translationContext ? {key: current.key, values: {...current.values, [message.id]: result}} : current);
        }
      }
    };
    // Keep engine requests bounded, including long conversations.
    void Promise.all([worker(), worker(), worker()]);
    return () => controller.abort();
    // The signature prevents polling the same thread from restarting translation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageSignature, translationContext, phrasesReady, retryTranslation]);

  async function activateTranslation(from: string) {
    if (activation?.context === translationContext && activation.busy) return;
    setActivation({context: translationContext, busy: true, notice: "Activation du moteur… Le navigateur peut télécharger un modèle de langue."});
    const enabled = await enableBrowserTranslation(from, language);
    if (!mounted.current || currentTranslationContext.current !== translationContext) return;
    setActivation({context: translationContext, busy: false, notice: enabled
      ? "Moteur activé pour cette paire de langues."
      : "Ce navigateur ne peut pas activer cette paire de langues. L’original reste disponible."});
    if (enabled) setRetryTranslation(value => value + 1);
  }

  async function send(payload: {body?: string; phraseId?: string}) {
    if (sendingRef.current || !thread?.open) return;
    sendingRef.current = true; setSending(true); setError("");
    ++sequence.current; fetching.current?.abort();
    const controller = new AbortController(); posting.current = controller;
    const key = JSON.stringify([context, payload]);
    if (request.current.key !== key) request.current = {key, id: crypto.randomUUID()};
    try {
      await api(`/api/orders/${encodeURIComponent(order.id)}/messages`, {method: "POST", body: JSON.stringify({...payload, requestId: request.current.id}), signal: controller.signal});
      if (!mounted.current || controller.signal.aborted || currentContext.current !== context) return;
      if (payload.body) setDraft(current => current.trim() === payload.body ? "" : current);
      request.current = {key: "", id: ""};
      if (currentAccess.current === accessContext) await load();
    } catch (caught) {
      if (!mounted.current || controller.signal.aborted || currentContext.current !== context) return;
      if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) setLoaded(null);
      if (caught instanceof ApiError && caught.status === 409 && currentAccess.current === accessContext) await load();
      if (currentContext.current === context && mounted.current) setError(caught instanceof Error ? caught.message : "Le message n’a pas été envoyé.");
    } finally {
      if (mounted.current && currentContext.current === context) { sendingRef.current = false; setSending(false); }
    }
  }

  function rendered(message: ThreadMessage) {
    const values = readings.key === translationContext ? readings.values : {};
    const reading = values[message.id];
    const showOriginal = originals[message.id] || message.language === language || !reading;
    return <>
      <p>{showOriginal ? message.body : reading!.text}</p>
      {message.language !== language && <span className="chat-origin">
        {reading
          ? <>{showOriginal ? `Écrit en ${languageNames[message.language] || message.language}` : reading.engine === "phrases" ? "Réponse rapide préparée dans votre langue" : `Traduction automatique du ${languageNames[message.language] || message.language}`}
              <button type="button" onClick={() => setOriginals(current => ({...current, [message.id]: !showOriginal}))}>{showOriginal ? "Afficher la traduction" : "Voir l’original"}</button></>
          : message.id in values
            ? <>Écrit en {languageNames[message.language] || message.language} — traduction indisponible pour ce message.<button type="button" onClick={() => setRetryTranslation(value => value + 1)}>Réessayer la traduction</button>
                {canEnableBrowserTranslation() && <button type="button" disabled={activation?.context === translationContext && activation.busy} onClick={() => void activateTranslation(message.language)}>Activer le moteur du navigateur</button>}</>
            : <>Recherche d’une traduction disponible… L’original reste affiché.</>}
      </span>}
    </>;
  }

  if (!thread) return <div className="order-chat"><p className="chat-empty" role={error ? "alert" : "status"}>{error || "Ouverture de la conversation…"}</p>{error && <button type="button" className="text-link" onClick={() => void load()}>Réessayer</button>}</div>;
  const replies = quickReplies[thread.viewerRole] || [];
  return <div className="order-chat">
    {thread.contacts.length > 0 && <ul className="chat-contacts">{thread.contacts.map(contact => <li key={contact.role}>
      <span><strong>{contact.label} · {contact.name}</strong><small>{contact.note}</small>
        {contact.language !== language && <small>Langue choisie : {languageNames[contact.language] || contact.language}. Traduction selon les moteurs disponibles.</small>}</span>
      {contact.phone
        ? <a className="chat-call" href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}><Phone size={16}/>Appeler</a>
        : <small className="chat-closed">Numéro indisponible à cette étape</small>}
    </li>)}</ul>}
    <div className="chat-messages" role="log" aria-label="Messages de la commande">
      {thread.messages.length === 0 && <p className="chat-empty">Aucun message. Écrivez ou choisissez une réponse rapide.</p>}
      {thread.messages.map(message => <div key={message.id} className={`chat-message ${message.mine ? "mine" : ""}`}>
        <span className="chat-author">{message.senderName}{message.senderRole === "admin" && " · Assistance"}<small>{time(message.date)}</small></span>
        {rendered(message)}
      </div>)}
      <div ref={bottom}/>
    </div>
    {activation?.context === translationContext && <p className="chat-note" role="status">{activation.notice}</p>}
    {error && <p className="checkout-error" role="alert">{error}</p>}
    {thread.open ? <>
      {replies.length > 0 && phrasesReady && <div className="chat-replies">{replies.map(phraseId => <button key={phraseId} type="button" disabled={sending || !phraseIn(phraseId, language)}
        onClick={() => void send({phraseId})}>{phraseIn(phraseId, language)}</button>)}</div>}
      {!phrasesReady && <button type="button" className="text-link" onClick={() => void loadPhrases().then(data => { if (mounted.current && currentContext.current === context) setPhrasesReady(Object.keys(data).length > 0); })}>Charger les réponses rapides</button>}
      <form className="chat-form" onSubmit={event => { event.preventDefault(); if (draft.trim()) void send({body: draft.trim()}); }}>
        <label className="sr-only" htmlFor={`chat-${order.id}`}>Votre message</label>
        <input id={`chat-${order.id}`} value={draft} maxLength={600} disabled={sending} placeholder="Écrivez dans votre langue…"
          onChange={event => setDraft(event.target.value)}/>
        <Button type="submit" variant="punch" size="icon" disabled={sending || !draft.trim()} aria-label="Envoyer"><Send size={18}/></Button>
      </form>
      <p className="chat-note"><Languages size={14}/>Langue choisie : {languageNames[language] || language}. Les réponses rapides sont préparées dans les langues proposées. Les textes libres nécessitent un moteur compatible ; leur traduction peut être imparfaite ou indisponible.</p>
    </> : <p className="chat-note">La conversation s’ouvre après acceptation et reste ouverte 30 minutes après la fin de la commande, puis reste consultable.</p>}
  </div>;
}
