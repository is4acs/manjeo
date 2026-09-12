import { api } from "@/lib/api";

// Traduction à la lecture, dans cet ordre :
// 1. livre de phrases — les réponses rapides sont traduites une fois à la main, donc
//    rendues à la perfection dans toutes les langues proposées, sans aucun moteur ;
// 2. moteur du navigateur (API Translator, sur l'appareil, gratuit) quand la paire existe ;
// 3. relais serveur, si l'exploitant a configuré un moteur (MANJEO_TRANSLATE_URL) ;
// 4. rien : le message reste dans sa langue et l'interface le dit franchement.
export type Engine = "phrases" | "browser" | "server";
export type Translation = { text: string; engine: Engine };

type BrowserTranslator = {
  availability: (pair: {sourceLanguage: string; targetLanguage: string}) => Promise<string>;
  create: (pair: {sourceLanguage: string; targetLanguage: string}) => Promise<{translate: (text: string) => Promise<string>}>;
};

const cache = new Map<string, Translation | null>();
const translators = new Map<string, Promise<{translate: (text: string) => Promise<string>} | null>>();
let phrases: Record<string, Record<string, string>> | null = null;
let relayAvailable = true;

export const languageNames: Record<string, string> = {
  fr: "français", ht: "créole haïtien", gcr: "créole guyanais",
  pt: "portugais", en: "anglais", es: "espagnol", zh: "chinois",
};

export async function loadPhrases() {
  if (phrases) return phrases;
  try {
    const data = await api<{phrases: {id: string; labels: Record<string, string>}[]}>("/api/phrases");
    phrases = Object.fromEntries(data.phrases.map(phrase => [phrase.id, phrase.labels]));
  } catch { phrases = {}; }
  return phrases;
}

export function phraseIn(phraseId: string, language: string) {
  return phrases?.[phraseId]?.[language] || "";
}

async function browserTranslator(from: string, to: string) {
  const key = `${from}:${to}`;
  if (!translators.has(key)) {
    translators.set(key, (async () => {
      const engine = (globalThis as unknown as {Translator?: BrowserTranslator}).Translator;
      if (!engine) return null;
      try {
        const availability = await engine.availability({sourceLanguage: from, targetLanguage: to});
        if (!availability || availability === "unavailable") return null;
        return await engine.create({sourceLanguage: from, targetLanguage: to});
      } catch { return null; }
    })());
  }
  return translators.get(key)!;
}

export async function translate(text: string, from: string, to: string): Promise<Translation | null> {
  if (!text.trim() || from === to) return null;
  const key = `${from}:${to}:${text}`;
  if (cache.has(key)) return cache.get(key)!;
  let result: Translation | null = null;
  const engine = await browserTranslator(from, to);
  if (engine) {
    try {
      const translated = await engine.translate(text);
      if (translated.trim()) result = {text: translated, engine: "browser"};
    } catch { /* Le moteur local a renoncé : le relais prend la suite. */ }
  }
  if (!result && relayAvailable) {
    try {
      const relayed = await api<{text: string}>("/api/translate", {method: "POST", body: JSON.stringify({text, from, to})});
      result = {text: relayed.text, engine: "server"};
    } catch (error) {
      // 503 : aucun moteur configuré. Inutile de redemander à chaque message.
      if ((error as {status?: number}).status === 503) relayAvailable = false;
    }
  }
  cache.set(key, result);
  return result;
}
