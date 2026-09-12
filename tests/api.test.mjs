import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEventListeners } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real API module with controlled transport and clocks. Transpile
// its parameter property without changing the application's production code.
const source = readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;

function client(transport) {
  const exports = {};
  const events = [];
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  vm.runInNewContext(javascript, {
    exports, AbortController, Event,
    fetch: (path, options) => {
      requests.push({path, options});
      return transport(path, options);
    },
    window: {
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, {callback, delay}); return id; },
      clearTimeout(id) { timers.delete(id); },
      dispatchEvent(event) { events.push(event.type); return true; },
    },
  });
  return {...exports, events, requests, timers};
}

const response = (status, payload) => new Response(JSON.stringify(payload), {status, headers: {'Content-Type': 'application/json'}});
const stalled = (_path, {signal}) => new Promise((_resolve, reject) => {
  const aborted = () => reject(new DOMException('Request aborted', 'AbortError'));
  if (signal.aborted) aborted();
  else signal.addEventListener('abort', aborted, {once: true});
});

test('an expected account is a transport precondition and never changes the order body', async () => {
  const module = client(async () => response(200, {ok: true}));
  const body = '{"requestId":"original-uuid","items":[]}';
  await module.api('/api/orders', {method: 'POST', accountId: 'customer-original', body});
  assert.equal(module.requests[0].options.headers['X-Manjeo-Account'], 'customer-original');
  assert.equal(module.requests[0].options.body, body);
  assert.equal('accountId' in module.requests[0].options, false);
  await module.api('/api/session');
  assert.equal(module.requests[1].options.headers['X-Manjeo-Account'], undefined);
});

test('an account precondition failure requests fresh session state and preserves its code', async () => {
  const module = client(async () => response(409, {error: 'Le compte connecté a changé.', code: 'session_changed'}));
  await assert.rejects(module.api('/api/orders', {method: 'POST', accountId: 'customer-a', body: '{}'}), error => error.status === 409 && error.code === 'session_changed');
  assert.deepEqual(module.events, ['manjeo-session-changed']);
  assert.equal(module.requests.length, 1, 'A failed command is never retried automatically under another cookie');
});

test('a 401 while confirming the session cannot recursively trigger expiration', async () => {
  const module = client(async () => response(401, {error: 'Session indisponible'}));
  await assert.rejects(module.api('/api/session'), error => error instanceof module.ApiError && error.status === 401);
  assert.deepEqual(module.events, []);
  assert.equal(module.requests.length, 1);
  assert.equal(module.timers.size, 0);
});

test('protected requests signal expiration, while rejected login stays in the login form', async () => {
  const module = client(async () => response(401, {error: 'Connectez-vous'}));
  await assert.rejects(module.api('/api/login', {method: 'POST', body: '{}'}), error => error.status === 401);
  assert.deepEqual(module.events, []);
  await assert.rejects(module.api('/api/orders'), error => error.status === 401);
  assert.deepEqual(module.events, ['manjeo-session-expired']);
  assert.equal(module.timers.size, 0);
});

test('unreadable successful responses fail as 502 and preserve HTTP errors on failures', async () => {
  for (const [status, expected] of [[200, 502], [503, 503]]) {
    const caller = new AbortController();
    const module = client(async () => new Response('<html>upstream error</html>', {status}));
    await assert.rejects(module.api('/api/orders', {signal: caller.signal}), error =>
      error instanceof module.ApiError && error.status === expected && /illisible/.test(error.message));
    assert.deepEqual(module.events, []);
    assert.equal(module.timers.size, 0);
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  }
});

test('the API deadline still aborts a stalled fetch when the caller supplies its own signal', async () => {
  const caller = new AbortController();
  const module = client(stalled);
  const pending = module.api('/api/orders', {signal: caller.signal});
  const rejected = assert.rejects(pending, /Le serveur ne répond pas/);
  const [deadline] = module.timers.values();
  assert.equal(deadline.delay, 15000);
  assert.notEqual(module.requests[0].options.signal, caller.signal);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 1);
  deadline.callback();
  await rejected;
  assert.equal(module.requests[0].options.signal.aborted, true);
  assert.equal(caller.signal.aborted, false);
  assert.equal(module.timers.size, 0);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});

test('caller cancellation aborts the actual fetch and removes the pending deadline', async () => {
  const caller = new AbortController();
  const module = client(stalled);
  const pending = module.api('/api/addresses?q=Baduel', {signal: caller.signal});
  const rejected = assert.rejects(pending, /Le serveur ne répond pas/);
  caller.abort();
  await rejected;
  assert.equal(module.requests[0].options.signal.aborted, true);
  assert.equal(module.timers.size, 0);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});

test('an already cancelled caller never starts an active fetch or leaves a timer behind', async () => {
  const caller = new AbortController();
  caller.abort();
  const module = client(stalled);
  await assert.rejects(module.api('/api/orders', {signal: caller.signal}), /Le serveur ne répond pas/);
  assert.equal(module.requests[0].options.signal.aborted, true);
  assert.equal(module.timers.size, 0);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});

test('successful requests preserve payload and credentials and detach the caller afterwards', async () => {
  const caller = new AbortController();
  const module = client(async () => response(200, {ok: true}));
  const result = await module.api('/api/orders', {method: 'POST', body: '{"requestId":"test"}', signal: caller.signal});
  assert.equal(result.ok, true);
  assert.equal(module.requests[0].options.credentials, 'same-origin');
  assert.equal(module.requests[0].options.body, '{"requestId":"test"}');
  assert.equal(module.timers.size, 0);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  caller.abort();
  assert.equal(module.requests[0].options.signal.aborted, false);
});
