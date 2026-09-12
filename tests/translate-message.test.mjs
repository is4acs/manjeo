import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEventListeners } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/translate.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const waitingMessage = 'Cette traduction est en cours. Réessayez dans quelques secondes.';
const failure = (status, message) => Object.assign(new Error(message), {status});
const success = (fields = {}) => ({text: 'Mwen rive.', from: 'pt', to: 'ht', provider: 'vercel', ...fields});

function client(transport) {
  const exports = {};
  const calls = [];
  const timers = new Map();
  const delays = [];
  let id = 0;
  const api = (url, options) => {
    calls.push({url, options, body: JSON.parse(options.body)});
    return transport(url, options);
  };
  vm.runInNewContext(javascript, {
    exports, require: name => { assert.equal(name, '@/lib/api'); return {api}; },
    setTimeout(callback, delay) { const timer = ++id; delays.push(delay); timers.set(timer, callback); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    Translator: {
      availability() { throw new Error('Message IDs must never use the unscoped browser engine'); },
      create() { throw new Error('Message IDs must never download a browser model'); },
    },
  });
  const fireTimer = () => {
    assert.equal(timers.size, 1, 'Exactly one bounded retry is pending');
    const [timer, callback] = timers.entries().next().value;
    timers.delete(timer); callback();
  };
  return {...exports, calls, timers, delays, fireTimer};
}

test('private translation sends only IDs and target language and uses the detected source', async () => {
  const caller = new AbortController();
  const module = client(async () => success());
  const result = await module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a', caller.signal);
  assert.equal(module.calls[0].url, '/api/translate');
  assert.equal(module.calls[0].options.method, 'POST');
  assert.deepEqual(module.calls[0].body, {orderId: 'order-a', messageId: 'message-a', to: 'ht'});
  assert.equal(module.calls[0].options.signal, caller.signal);
  assert.equal(result.text, 'Mwen rive.');
  assert.equal(result.source, 'pt');
  assert.equal(result.engine, 'server');
  assert.equal(module.timers.size, 0);
});

test('matching detected and target language still reaches the server instead of trusting a profile hint', async () => {
  const module = client(async () => success({from: 'ht', text: 'Mwen deja la.'}));
  const result = await module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a');
  assert.equal(module.calls.length, 1);
  assert.equal(result.source, 'ht');
  assert.equal(result.text, 'Mwen deja la.');
});

test('prepared server replies retain their distinct engine label', async () => {
  const module = client(async () => success({provider: 'phrases'}));
  assert.equal((await module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a')).engine, 'phrases');
});

test('a previous success cannot bypass a later server refusal after a courier loses access', async () => {
  let requests = 0;
  const module = client(async () => {
    if (++requests === 1) return success();
    throw failure(403, 'Cette conversation ne vous concerne pas.');
  });
  assert.ok(await module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a'));
  assert.equal(await module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a'), null);
  assert.equal(requests, 2);
  assert.equal(module.timers.size, 0);
});

test('concurrent reads share only their exact viewer, order, message, target and cancellation scope', async () => {
  const resolvers = [];
  const module = client((_url, options) => new Promise(resolve => resolvers.push(() => resolve(success({to: JSON.parse(options.body).to})))));
  const caller = new AbortController();
  const anotherLifetime = new AbortController();
  const reads = [
    module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a', caller.signal),
    module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a', caller.signal),
    module.translateMessage('order-a', 'message-a', 'ht', 'viewer-b', caller.signal),
    module.translateMessage('order-b', 'message-a', 'ht', 'viewer-a', caller.signal),
    module.translateMessage('order-a', 'message-b', 'ht', 'viewer-a', caller.signal),
    module.translateMessage('order-a', 'message-a', 'pt', 'viewer-a', caller.signal),
    module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a', anotherLifetime.signal),
  ];
  assert.equal(module.calls.length, 6);
  for (const resolve of resolvers) resolve();
  assert.ok((await Promise.all(reads)).every(Boolean));
});

test('late completion of an abandoned read neither displays its result nor removes the reopened request', async () => {
  const resolvers = [];
  const module = client(() => new Promise(resolve => resolvers.push(resolve)));
  const previous = new AbortController();
  const current = new AbortController();
  const abandoned = module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a', previous.signal);
  previous.abort();
  const reopened = module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a', current.signal);
  resolvers[0](success({text: 'Ancienne lecture'}));
  assert.equal(await abandoned, null);
  const sameReopened = module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a', current.signal);
  assert.equal(module.calls.length, 2);
  resolvers[1](success());
  assert.equal((await reopened).text, 'Mwen rive.');
  assert.equal((await sameReopened).text, 'Mwen rive.');
});

test('malformed translation payloads keep the original visible and are not retried', async () => {
  const malformed = [
    null, {}, success({text: ''}), success({text: ' \n '}), success({text: 42}),
    success({to: 'pt'}), success({from: null}), success({from: ''}), success({from: 'xx'}),
    success({provider: undefined}), success({provider: 'unknown'}), success({text: 'x'.repeat(4001)}),
  ];
  for (const payload of malformed) {
    const module = client(async () => payload);
    assert.equal(await module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a'), null, JSON.stringify(payload)?.slice(0, 150));
    assert.equal(module.calls.length, 1);
    assert.equal(module.timers.size, 0);
  }
});

test('only the short server reservation retries, then succeeds within the bounded schedule', async () => {
  let requests = 0;
  const module = client(async () => {
    if (++requests < 4) throw failure(429, waitingMessage);
    return success();
  });
  const caller = new AbortController();
  const pending = module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a', caller.signal);
  for (let attempt = 0; attempt < 3; attempt++) { await flush(); module.fireTimer(); }
  assert.equal((await pending).text, 'Mwen rive.');
  assert.equal(requests, 4);
  assert.deepEqual(module.delays, [2000, 4000, 8000]);
  assert.equal(module.timers.size, 0);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});

test('a reservation that never completes stops after four attempts', async () => {
  const module = client(async () => { throw failure(429, waitingMessage); });
  const pending = module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a');
  for (let attempt = 0; attempt < 3; attempt++) { await flush(); module.fireTimer(); }
  assert.equal(await pending, null);
  assert.equal(module.calls.length, 4);
  assert.equal(module.timers.size, 0);
});

test('quota, activation, provider load and unrelated failures never create automatic retries', async () => {
  for (const error of [
    failure(429, 'Le quota quotidien de traduction de la démonstration est atteint. Les messages originaux restent disponibles.'),
    failure(429, 'Le moteur de traduction reçoit trop de demandes. Réessayez dans quelques secondes.'),
    failure(503, 'Le moteur de traduction doit être activé par l’administrateur dans Vercel AI Gateway (vérification du compte requise).'),
    failure(403, 'Cette conversation ne vous concerne pas.'), failure(502, waitingMessage), new Error('offline'),
  ]) {
    const module = client(async () => { throw error; });
    assert.equal(await module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a'), null);
    assert.equal(module.calls.length, 1);
    assert.equal(module.timers.size, 0);
  }
});

test('cancellation during the reservation wait removes its timer and prevents another request', async () => {
  const caller = new AbortController();
  const module = client(async () => { throw failure(429, waitingMessage); });
  const pending = module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a', caller.signal);
  await flush();
  assert.equal(module.timers.size, 1);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 1);
  caller.abort();
  assert.equal(await pending, null);
  assert.equal(module.calls.length, 1);
  assert.equal(module.timers.size, 0);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});

test('a pre-aborted signal makes no request and an in-flight abort is forwarded to the API', async () => {
  const caller = new AbortController();
  caller.abort();
  const module = client((_url, {signal}) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true});
  }));
  assert.equal(await module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a', caller.signal), null);
  assert.equal(module.calls.length, 0);
  const next = new AbortController();
  const pending = module.translateMessage('order-a', 'message-a', 'ht', 'viewer-a', next.signal);
  assert.equal(module.calls[0].options.signal, next.signal);
  next.abort();
  assert.equal(await pending, null);
  assert.equal(module.timers.size, 0);
});
