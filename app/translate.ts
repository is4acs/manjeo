import { api } from "@/lib/api";

// Prepared quick replies are distinct from translation of arbitrary messages.
// Free text uses a browser engine already available for the language pair,
// then the optional operator-configured server relay. Failure keeps the original.
export type Engine = "phrases" | "browser" | "server";
export type Translation = { text: string; engine: Engine; source?: string };
type Translator = {translate: (text: string) => Promise<string>};
type BrowserTranslator = {
  availability: (pair: {sourceLanguage: string; targetLanguage: string}) => Promise<string>;
  create: (pair: {sourceLanguage: string; targetLanguage: string}) => Promise<Translator>;
};
const cache = new Map<string, Translation>();
const pending = new Map<string, {operation: Promise<Translation | null>; signal?: AbortSignal}>();
const translators = new Map<string, Translator>();
let phrases: Record<string, Record<string, string>> | null = null;
let phrasesPending: Promise<Record<string, Record<string, string>>> | null = null;

export const languageNames: Record<string, string> = {
  fr: "français", ht: "créole haïtien", gcr: "créole guyanais",
  pt: "portugais", en: "anglais", es: "espagnol", zh: "chinois",
};

export async function loadPhrases(): Promise<Record<string, Record<string, string>>> {
  if (phrases) return phrases;
  if (!phrasesPending) {
    phrasesPending = api<{phrases: {id: string; labels: Record<string, string>}[]}>("/api/phrases")
      .then(data => { phrases = Object.fromEntries(data.phrases.map(phrase => [phrase.id, phrase.labels])); return phrases; })
      .catch(() => ({}))
      .finally(() => { phrasesPending = null; });
  }
  return phrasesPending;
}

export function phraseIn(phraseId: string, language: string) {
  return phrases?.[phraseId]?.[language] || "";
}

async function timed<T>(operation: Promise<T>, milliseconds = 6000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([operation, new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Translation engine timeout")), milliseconds);
    })]);
  } finally { clearTimeout(timeout!); }
}

export function canEnableBrowserTranslation() {
  return typeof (globalThis as unknown as {Translator?: BrowserTranslator}).Translator?.create === "function";
}

// Call directly from a click: the browser requires user activation and may
// download a language pack. Merely reading messages never starts that download.
export async function enableBrowserTranslation(from: string, to: string): Promise<boolean> {
  const engine = (globalThis as unknown as {Translator?: BrowserTranslator}).Translator;
  if (!engine || from === to) return false;
  try {
    const translator = await timed(engine.create({sourceLanguage: from, targetLanguage: to}), 60000);
    translators.set(`${from}:${to}`, translator);
    return true;
  } catch { return false; }
}

async function browserTranslator(from: string, to: string): Promise<Translator | null> {
  const key = `${from}:${to}`;
  if (translators.has(key)) return translators.get(key)!;
  const engine = (globalThis as unknown as {Translator?: BrowserTranslator}).Translator;
  if (!engine) return null;
  try {
    const pair = {sourceLanguage: from, targetLanguage: to};
    // Reading a thread must not silently initiate a language-model download.
    if (await timed(engine.availability(pair)) !== "available") return null;
    const translator = await timed(engine.create(pair));
    translators.set(key, translator);
    return translator;
  } catch { return null; }
}

export async function translate(text: string, from: string, to: string, viewerId = "", signal?: AbortSignal): Promise<Translation | null> {
  if (!text.trim() || from === to || signal?.aborted) return null;
  const key = JSON.stringify([viewerId, from, to, text]);
  if (cache.has(key)) return cache.get(key)!;
  const existing = pending.get(key);
  // A different reader owns a different cancellation lifetime. Reopening a
  // thread must not inherit a request its previous instance has just aborted.
  if (existing && existing.signal === signal) return existing.operation;
  const operation = (async (): Promise<Translation | null> => {
    const engine = await browserTranslator(from, to);
    if (signal?.aborted) return null;
    if (engine) {
      try {
        const translated = await timed(engine.translate(text));
        if (signal?.aborted) return null;
        if (typeof translated === "string" && translated.trim()) return {text: translated, engine: "browser"};
      } catch { translators.delete(`${from}:${to}`); }
    }
    if (signal?.aborted) return null;
    try {
      const result = await api<{text: string}>("/api/translate", {method: "POST", accountId:viewerId || undefined, body: JSON.stringify({text, from, to}), signal});
      if (signal?.aborted) return null;
      return typeof result.text === "string" && result.text.trim() ? {text: result.text, engine: "server"} : null;
    } catch { return null; }
  })();
  pending.set(key, {operation, signal});
  try {
    const result = await operation;
    if (result) {
      cache.set(key, result);
      if (cache.size > 200) cache.delete(cache.keys().next().value!);
    }
    // Temporary failures are deliberately not cached; a later explicit retry
    // can recover after a network outage or server-engine configuration change.
    return result;
  } finally { if (pending.get(key)?.operation === operation) pending.delete(key); }
}

const messageRequests = new Map<string, {operation: Promise<Translation | null>; signal?: AbortSignal}>();
function retryPause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort',done); resolve(); };
    const timer = setTimeout(done,milliseconds);
    if (signal?.aborted) done(); else signal?.addEventListener('abort',done,{once:true});
  });
}
/** Private message IDs let the server recheck access and detect the actual language. */
export async function translateMessage(orderId: string, messageId: string, to: string, viewerId: string, signal?: AbortSignal): Promise<Translation | null> {
  if (signal?.aborted) return null;
  const key = JSON.stringify([viewerId,orderId,messageId,to]);
  const existing = messageRequests.get(key);
  if (existing && existing.signal === signal) return existing.operation;
  const operation = (async (): Promise<Translation | null> => {
    for (let attempt=0; attempt<4 && !signal?.aborted; attempt++) {
      try {
        const result = await api<{text:string;from:string;to:string;provider:string}>('/api/translate', {
          method:'POST',accountId:viewerId,body:JSON.stringify({orderId,messageId,to}),signal,
        });
        if (signal?.aborted || result.to !== to || typeof result.text !== 'string' || !result.text.trim() || Array.from(result.text).length > 4000 || typeof result.from !== 'string' || !Object.hasOwn(languageNames,result.from) || !['phrases','vercel','libretranslate'].includes(result.provider)) return null;
        return {text:result.text,engine:result.provider === 'phrases' ? 'phrases' : 'server',source:result.from};
      } catch (error) {
        const failure = error as {status?:number;message?:string};
        // Retry only another reader's short reservation, never quota or billing failures.
        if (attempt === 3 || failure.status !== 429 || failure.message !== 'Cette traduction est en cours. Réessayez dans quelques secondes.') return null;
        await retryPause([2000,4000,8000][attempt],signal);
      }
    }
    return null;
  })();
  messageRequests.set(key,{operation,signal});
  try { return await operation; }
  finally { if (messageRequests.get(key)?.operation === operation) messageRequests.delete(key); }
}
