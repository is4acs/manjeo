import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Isolate browser capabilities and module caches without making real network
// requests or downloading language models in the test runner.
const source = readFileSync(new URL('../app/translate.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
function engine(api, Translator) {
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, require: name => { assert.equal(name, '@/lib/api'); return {api}; },
    setTimeout, clearTimeout, Translator,
  });
  return exports;
}

test('prepared replies recover after a temporary failure and do not translate arbitrary text', async () => {
  let calls = 0;
  const module = engine(async path => {
    assert.equal(path, '/api/phrases');
    if (++calls === 1) throw new Error('offline');
    return {phrases: [{id: 'thanks', labels: {fr: 'Merci', ht: 'Mèsi'}}]};
  });
  await module.loadPhrases();
  assert.equal(module.phraseIn('thanks', 'ht'), '');
  await module.loadPhrases();
  assert.equal(module.phraseIn('thanks', 'ht'), 'Mèsi');
  assert.equal(module.phraseIn('texte libre', 'ht'), '');
  assert.equal(calls, 2);
});

test('a failed relay can be retried; successful translations are isolated per account and language', async () => {
  const calls = [];
  const module = engine(async (path, options) => {
    calls.push([path, JSON.parse(options.body)]);
    if (calls.length === 1) throw new Error('unavailable');
    return {text: 'Hello'};
  });
  assert.equal(await module.translate('Bonjour', 'fr', 'en', 'client-a'), null);
  assert.equal((await module.translate('Bonjour', 'fr', 'en', 'client-a')).engine, 'server');
  await module.translate('Bonjour', 'fr', 'en', 'client-a');
  assert.equal(calls.length, 2);
  await module.translate('Bonjour', 'fr', 'en', 'client-b');
  await module.translate('Bonjour', 'fr', 'pt', 'client-b');
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.at(-1), ['/api/translate', {text: 'Bonjour', from: 'fr', to: 'pt'}]);
});

test('reading never downloads a browser model; explicit activation enables later translation', async () => {
  let creations = 0;
  let relays = 0;
  const module = engine(async () => { relays++; throw new Error('no relay'); }, {
    availability: async () => 'downloadable',
    create: async pair => {
      creations++;
      assert.equal(pair.sourceLanguage, 'pt');
      assert.equal(pair.targetLanguage, 'fr');
      return {translate: async text => text === 'Bom dia' ? 'Bonjour' : ''};
    },
  });
  assert.equal(module.canEnableBrowserTranslation(), true);
  assert.equal(await module.translate('Bom dia', 'pt', 'fr', 'client'), null);
  assert.equal(creations, 0);
  assert.equal(await module.enableBrowserTranslation('pt', 'fr'), true);
  assert.equal((await module.translate('Bom dia', 'pt', 'fr', 'client')).text, 'Bonjour');
  assert.equal(creations, 1);
  assert.equal(relays, 1);
});

test('unsupported browser languages preserve the original when no relay exists', async () => {
  const module = engine(async () => { throw new Error('no relay'); }, {
    availability: async () => 'unavailable',
    create: async () => { throw new Error('unsupported pair'); },
  });
  assert.equal(await module.enableBrowserTranslation('ht', 'gcr'), false);
  assert.equal(await module.translate('Mèsi', 'ht', 'gcr', 'client'), null);
});

test('aborting while browser availability resolves prevents text reaching the relay', async () => {
  let settle;
  let calls = 0;
  const module = engine(async () => { calls++; return {text: 'ignored'}; }, {
    availability: () => new Promise(resolve => { settle = resolve; }),
    create: async () => { throw new Error('must not create'); },
  });
  const controller = new AbortController();
  const pending = module.translate('Texte privé', 'fr', 'en', 'client', controller.signal);
  controller.abort();
  settle('unavailable');
  assert.equal(await pending, null);
  assert.equal(calls, 0);
});

test('concurrent repeated reads share one relay request', async () => {
  let settle;
  let calls = 0;
  const module = engine(async () => { calls++; return new Promise(resolve => { settle = resolve; }); });
  const first = module.translate('Merci', 'fr', 'en', 'client');
  const second = module.translate('Merci', 'fr', 'en', 'client');
  await new Promise(resolve => setImmediate(resolve));
  settle({text: 'Thanks'});
  const readings = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(readings[0].text, 'Thanks');
  assert.equal(readings[1].text, 'Thanks');
});

test('a reopened conversation does not inherit its previous cancelled translation', async () => {
  const availability = [];
  let relays = 0;
  const module = engine(async () => { relays++; return {text: 'Hello'}; }, {
    availability: () => new Promise(resolve => { availability.push(resolve); }),
    create: async () => { throw new Error('unsupported'); },
  });
  const previous = new AbortController();
  const current = new AbortController();
  const abandoned = module.translate('Bonjour', 'fr', 'en', 'client', previous.signal);
  previous.abort();
  const reopened = module.translate('Bonjour', 'fr', 'en', 'client', current.signal);
  assert.equal(availability.length, 2);
  for (const resolve of availability) resolve('unavailable');
  assert.equal(await abandoned, null);
  assert.equal((await reopened).text, 'Hello');
  assert.equal(relays, 1);
});
