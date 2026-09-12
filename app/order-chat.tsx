"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Languages, Phone, Send } from "lucide-react";
import { t, formatDate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { api, ApiError, type Order, type Thread, type ThreadMessage } from "@/lib/api";
import { languageNames, loadPhrases, phraseIn, translateMessage, type Translation } from "./translate";

const quickReplies: Record<string, string[]> = {
  client: ["downstairs", "cannot_find", "thanks"],
  restaurant: ["order_ready", "running_late", "thanks"],
  courier: ["on_my_way", "at_the_door", "cannot_find", "running_late"],
  admin: ["thanks"],
};
const time = (value: string) => formatDate(value, {hour: "2-digit", minute: "2-digit"});

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
  const readingCache = useRef<{key:string; retry:number; values:Record<string,Translation|null>}>({key:"",retry:0,values:{}});
  const [originals, setOriginals] = useState<Record<string, boolean>>({});
  const [phrasesReady, setPhrasesReady] = useState(false);
  const [retryTranslation, setRetryTranslation] = useState({version:0,messageId:""});
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
      if (data.viewerId !== viewerId) { setLoaded(null); readingCache.current = {key:"",retry:0,values:{}}; setReadings({key:"",values:{}}); setError("Le compte connecté a changé. Rouvrez la conversation."); return; }
      setLoaded({context, access: accessContext, value: data}); setError("");
      window.dispatchEvent(new CustomEvent("manjeo-thread-read", {detail: {orderId: order.id, viewerId}}));
    } catch (caught) {
      if (!mounted.current || controller.signal.aborted || currentAccess.current !== accessContext || sequence.current !== version) return;
      // Revocation must remove old phone numbers and messages immediately.
      if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) { setLoaded(null); readingCache.current = {key:"",retry:0,values:{}}; setReadings({key:"",values:{}}); }
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

  const translationContext = `${context}:${order.courierId || ""}:${language}`;
  const messageSignature = JSON.stringify(thread?.messages.map(message => [message.id, message.body, message.language, message.phraseId]) || []);
  useEffect(() => {
    const controller = new AbortController();
    // A status transition hides the old thread until access is revalidated.
    // Keep earlier readings through this gap; an explicit access refusal clears
    // them in load(), and an assignment/account/language change has another key.
    if (!thread) return () => controller.abort();
    const messages = thread?.messages || [];
    const previous = readingCache.current;
    const sameContext = previous.key === translationContext;
    const ids = new Set(messages.map(message => message.id));
    // New messages must not retranslate the entire conversation or consume the
    // quota again for earlier failures. Only an explicit retry restarts failures.
    const values = sameContext ? Object.fromEntries(Object.entries(previous.values).filter(([id,value]) => ids.has(id) && (value !== null || previous.retry === retryTranslation.version || id !== retryTranslation.messageId))) : {};
    readingCache.current = {key:translationContext,retry:retryTranslation.version,values};
    setReadings({key:translationContext,values});
    if (!sameContext) setOriginals({});
    const queue = messages.filter(message => !(message.id in values) && (message.phraseId ? message.language !== language : !message.mine || message.language !== language));
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const message = queue.shift()!;
        const prepared = message.phraseId ? phraseIn(message.phraseId, language) : "";
        const result = prepared ? {text: prepared, engine: "phrases" as const} : await translateMessage(order.id, message.id, language, viewerId, controller.signal);
        if (!controller.signal.aborted && mounted.current && currentAccess.current === accessContext && readingCache.current.key === translationContext) {
          const next = {...readingCache.current.values,[message.id]:result};
          readingCache.current = {...readingCache.current,values:next};
          setReadings({key:translationContext,values:next});
        }
      }
    };
    // Keep engine requests bounded, including long conversations.
    void Promise.all([worker(), worker(), worker()]);
    return () => controller.abort();
    // The signature prevents polling the same thread from restarting translation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageSignature, translationContext, accessContext, phrasesReady, retryTranslation]);

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
      if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) { setLoaded(null); readingCache.current = {key:"",retry:0,values:{}}; setReadings({key:"",values:{}}); }
      if (caught instanceof ApiError && caught.status === 409 && currentAccess.current === accessContext) await load();
      if (currentContext.current === context && mounted.current) setError(caught instanceof Error ? caught.message : "Le message n’a pas été envoyé.");
    } finally {
      if (mounted.current && currentContext.current === context) { sendingRef.current = false; setSending(false); }
    }
  }

  function rendered(message: ThreadMessage) {
    const values = readings.key === translationContext ? readings.values : {};
    const reading = values[message.id];
    const eligible = message.phraseId ? message.language !== language : !message.mine || message.language !== language;
    const originalLanguage = reading?.source || message.language;
    const alreadyInLanguage = reading?.source === language;
    const showOriginal = originals[message.id] || !eligible || !reading || alreadyInLanguage;
    return <>
      <p lang={showOriginal ? originalLanguage : language}>{showOriginal ? message.body : reading!.text}</p>
      {eligible && !alreadyInLanguage && <span className="chat-origin">
        {reading
          ? <>{showOriginal ? t('Écrit en {language}',{language:t(languageNames[originalLanguage] || originalLanguage)}) : reading.engine === 'phrases' ? t('Réponse rapide préparée dans votre langue') : t('Traduction automatique · {language}',{language:t(languageNames[originalLanguage] || originalLanguage)})}
              <button type="button" onClick={() => setOriginals(current => ({...current, [message.id]: !showOriginal}))}>{t(showOriginal ? 'Afficher la traduction' : 'Voir l’original')}</button></>
          : message.id in values
            ? <>{t('Traduction indisponible. Le message original reste affiché.')}<button type="button" onClick={() => setRetryTranslation(value => ({version:value.version + 1,messageId:message.id}))}>{t('Réessayer la traduction')}</button></>
            : <>{t('Traduction en cours… L’original reste affiché.')}</>}
      </span>}
    </>;
  }

  if (!thread) return <div className="order-chat"><p className="chat-empty" role={error ? "alert" : "status"}>{t(error || "Ouverture de la conversation…")}</p>{error && <button type="button" className="text-link" onClick={() => void load()}>{t('Réessayer')}</button>}</div>;
  const replies = quickReplies[thread.viewerRole] || [];
  return <div className="order-chat">
    {thread.contacts.length > 0 && <ul className="chat-contacts">{thread.contacts.map(contact => <li key={contact.role}>
      <span><strong>{t(contact.label)} · {contact.name}</strong><small>{thread.viewerRole === 'admin' || contact.role === 'courier' ? t(contact.note) : contact.note}</small>
        {contact.language !== language && <small>{t('Langue choisie : {language}.',{language:t(languageNames[contact.language] || contact.language)})}</small>}</span>
      {contact.phone
        ? <a className="chat-call" href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}><Phone size={16}/>{t('Appeler')}</a>
        : <small className="chat-closed">{t('Numéro indisponible à cette étape')}</small>}
    </li>)}</ul>}
    <div className="chat-messages" role="log" aria-label={t('Messages de la commande')}>
      {thread.messages.length === 0 && <p className="chat-empty">{t('Aucun message. Écrivez ou choisissez une réponse rapide.')}</p>}
      {thread.messages.map(message => <div key={message.id} className={`chat-message ${message.mine ? "mine" : ""}`}>
        <span className="chat-author">{message.senderName}{message.senderRole === "admin" && ` · ${t('Assistance')}`}<small>{time(message.date)}</small></span>
        {rendered(message)}
      </div>)}
      <div ref={bottom}/>
    </div>
    {error && <p className="checkout-error" role="alert">{t(error)}</p>}
    {thread.open ? <>
      {replies.length > 0 && phrasesReady && <div className="chat-replies">{replies.map(phraseId => <button key={phraseId} type="button" disabled={sending || !phraseIn(phraseId, language)}
        onClick={() => void send({phraseId})}>{phraseIn(phraseId, language)}</button>)}</div>}
      {!phrasesReady && <button type="button" className="text-link" onClick={() => void loadPhrases().then(data => { if (mounted.current && currentContext.current === context) setPhrasesReady(Object.keys(data).length > 0); })}>{t('Charger les réponses rapides')}</button>}
      <form className="chat-form" onSubmit={event => { event.preventDefault(); if (draft.trim()) void send({body: draft.trim()}); }}>
        <label className="sr-only" htmlFor={`chat-${order.id}`}>{t('Votre message')}</label>
        <input id={`chat-${order.id}`} value={draft} maxLength={600} disabled={sending} placeholder={t('Écrivez dans votre langue…')}
          onChange={event => setDraft(event.target.value)}/>
        <Button type="submit" variant="punch" size="icon" disabled={sending || !draft.trim()} aria-label={t('Envoyer')}><Send size={18}/></Button>
      </form>
      <p className="chat-note"><Languages size={14}/>{t('Langue choisie : {language}.',{language:t(languageNames[language] || language)})} {t('L’original reste disponible, même lorsqu’une traduction ne peut pas être obtenue.')} {t('La traduction automatique peut comporter des erreurs. Vérifiez les informations importantes.')}</p>
    </> : <p className="chat-note">{t('La conversation s’ouvre après acceptation et reste ouverte 30 minutes après la fin de la commande, puis reste consultable.')}</p>}
  </div>;
}
