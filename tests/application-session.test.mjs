import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute Application itself, preserving hook state and effect lifetimes while
// controlling the order of network responses and native window events.
const source = ts.transpileModule(readFileSync(new URL('../app/application.tsx', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
}).outputText;
const customer = id => ({id, name: id, email: `${id}@manjeo.test`, role: 'client', language: 'fr', phone: '', restaurantId: null});
const restaurants = [{id: 'ti-kreol', name: 'Ti Kréol'}];
const event = {preventDefault() {}};

function harness() {
  const hooks = [], effects = [], requests = [], listeners = new Map();
  let cursor = 0, dirty = false, alive = true, tree, writesAfterUnmount = 0;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const slot = (kind, initial) => {
    const index = cursor++;
    if (!hooks[index]) hooks[index] = {kind, ...initial()};
    assert.equal(hooks[index].kind, kind, 'Hook ordering must stay valid between real component renders');
    return hooks[index];
  };
  const react = {
    useState(initial) {
      const hook = slot('state', () => ({value: typeof initial === 'function' ? initial() : initial}));
      return [hook.value, value => {
        if (!alive) writesAfterUnmount++;
        const next = typeof value === 'function' ? value(hook.value) : value;
        if (!Object.is(hook.value, next)) { hook.value = next; dirty = true; }
      }];
    },
    useRef(initial) { return slot('ref', () => ({value: {current: initial}})).value; },
    useCallback(callback, dependencies) {
      const hook = slot('callback', () => ({}));
      if (!same(hook.dependencies, dependencies)) { hook.value = callback; hook.dependencies = dependencies; }
      return hook.value;
    },
    useEffect(effect, dependencies) {
      const hook = slot('effect', () => ({}));
      if (!same(hook.dependencies, dependencies)) {
        hook.dependencies = dependencies;
        effects.push(() => { hook.cleanup?.(); hook.cleanup = effect(); });
      }
    },
  };
  const components = Object.fromEntries(['Home', 'Staff', 'LanguageBar', 'Dialog', 'DialogContent', 'DialogDescription', 'DialogTitle', 'Button', 'Input'].map(name => [name, function component() {}]));
  const exports = {};
  const addEventListener = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
  };
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return {jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props})};
      if (name === '@/lib/api') return {api(path, options = {}) {
        return new Promise((resolve, reject) => requests.push({path, options, resolve, reject, taken: false}));
      }};
      if (name === '@/lib/i18n') return {t: value => value, documentLanguage: () => 'fr', normalizeLanguage: value => value, languageOptions: []};
      if (name === './i18n') return {useLanguage: () => 'fr', adoptProfileLanguage() {}, chooseLanguage() {}, LanguageBar: components.LanguageBar};
      if (name === './validation') return {refreshValidationLanguage() {}};
      if (name === './page') return {default: components.Home};
      if (name === './staff') return {default: components.Staff};
      return components;
    },
    window: {addEventListener, removeEventListener: (name, callback) => listeners.get(name)?.delete(callback)},
    document: {documentElement: {}},
    localStorage: {setItem() {}}, crypto: {randomUUID: () => 'session-change'},
  });
  function render() {
    cursor = 0; dirty = false; tree = exports.default();
    while (effects.length) effects.shift()();
  }
  async function flush() {
    for (let turn = 0; turn < 10; turn++) {
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty || !alive) return;
      render();
    }
    throw new Error('Application did not settle');
  }
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(value => nodes(value));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children)];
  }
  function take(path) {
    const request = requests.find(item => item.path === path && !item.taken);
    assert.ok(request, `Expected pending request ${path}`);
    request.taken = true;
    return request;
  }
  const dispatch = name => {
    const payload = name === 'storage' ? {key: 'manjeo-session-change'} : {};
    for (const callback of listeners.get(name) || []) callback(payload);
  };
  render();
  return {
    requests, take, dispatch, flush,
    home: () => nodes(tree).find(node => node.type === components.Home),
    find: predicate => nodes(tree).find(predicate),
    startup: () => !!nodes(tree).find(node => node.props?.className === 'app-startup'),
    button: label => nodes(tree).find(node => node.type === components.Button && node.props.children === label),
    unmount() { alive = false; for (const hook of hooks) if (hook.kind === 'effect') hook.cleanup?.(); },
    get writesAfterUnmount() { return writesAfterUnmount; },
  };
}

async function settleInitial(app, user = customer('first')) {
  app.take('/api/session').resolve({user});
  app.take('/api/restaurants').resolve({restaurants});
  await app.flush();
}

test('startup normally loads both the account and catalog without another session request', async () => {
  const app = harness();
  await settleInitial(app);
  assert.equal(app.home().props.user.id, 'first');
  assert.deepEqual(app.home().props.restaurants, restaurants);
  assert.equal(app.startup(), false);
  assert.equal(app.requests.filter(item => item.path === '/api/session').length, 1);
});

for (const name of ['storage', 'focus', 'manjeo-session-expired']) {
  test(`${name} during startup refreshes the account without abandoning the catalog or leaving a spinner`, async () => {
    const app = harness();
    app.dispatch(name); app.dispatch(name);
    assert.equal(app.requests.length, 2, 'Events are coalesced while the initial catalog/session load runs');
    await settleInitial(app, customer('stale'));
    assert.equal(app.startup(), true, 'Do not display the potentially stale account');
    assert.equal(app.home(), undefined);
    app.take('/api/session').resolve({user: customer('fresh')});
    await app.flush();
    assert.equal(app.startup(), false);
    assert.equal(app.home().props.user.id, 'fresh');
    assert.deepEqual(app.home().props.restaurants, restaurants);
    assert.equal(app.requests.filter(item => item.path === '/api/session').length, 2);
  });
}

test('another account change during the fresh read is rechecked before completing startup', async () => {
  const app = harness();
  app.dispatch('focus');
  await settleInitial(app, customer('old'));
  const staleRefresh = app.take('/api/session');
  app.dispatch('storage');
  staleRefresh.resolve({user: customer('already-replaced')});
  await app.flush();
  assert.equal(app.home(), undefined);
  app.take('/api/session').resolve({user: customer('latest')});
  await app.flush();
  assert.equal(app.home().props.user.id, 'latest');
  assert.equal(app.startup(), false);
});

test('a logout in another tab during startup cannot restore the original signed-in account', async () => {
  const app = harness();
  app.dispatch('storage');
  await settleInitial(app);
  app.take('/api/session').resolve({user: null});
  await app.flush();
  assert.equal(app.startup(), false);
  assert.equal(app.home().props.user, null);
  assert.deepEqual(app.home().props.restaurants, restaurants);
});

test('a failed fresh read ends loading with a working retry instead of keeping a spinner', async () => {
  const app = harness();
  app.dispatch('focus');
  await settleInitial(app);
  app.take('/api/session').reject(new Error('Session temporairement indisponible.'));
  await app.flush();
  assert.ok(app.find(node => node.type === 'p' && node.props.children === 'Session temporairement indisponible.'));
  const retry = app.button('Réessayer');
  assert.ok(retry);
  void retry.props.onClick();
  await settleInitial(app, customer('retried'));
  assert.equal(app.startup(), false);
  assert.equal(app.home().props.user.id, 'retried');
});

test('catalog failure also remains retryable when a session event arrives during startup', async () => {
  const app = harness();
  app.dispatch('storage');
  app.take('/api/session').resolve({user: customer('old')});
  app.take('/api/restaurants').reject(new Error('Catalogue temporairement indisponible.'));
  await app.flush();
  assert.ok(app.button('Réessayer'));
  void app.button('Réessayer').props.onClick();
  app.dispatch('focus');
  await settleInitial(app, customer('stale-retry'));
  app.take('/api/session').resolve({user: customer('fresh-retry')});
  await app.flush();
  assert.equal(app.home().props.user.id, 'fresh-retry');
  assert.equal(app.startup(), false);
});

test('late startup responses cannot update an unmounted application', async () => {
  const app = harness();
  app.dispatch('storage');
  await settleInitial(app);
  const refresh = app.take('/api/session');
  app.unmount();
  refresh.resolve({user: customer('late')});
  await app.flush();
  assert.equal(app.writesAfterUnmount, 0);
});

test('after startup, a late login cannot replace the account selected in another tab', async () => {
  const app = harness();
  await settleInitial(app, null);
  app.home().props.onAccount();
  await app.flush();
  const form = app.find(node => node.type === 'form' && node.props.className === 'account-form');
  assert.ok(form);
  const login = form.props.onSubmit(event);
  const lateLogin = app.take('/api/login');
  app.dispatch('storage');
  app.take('/api/session').resolve({user: customer('other-tab')});
  await app.flush();
  lateLogin.resolve({user: customer('stale-login')});
  await login; await app.flush();
  assert.equal(app.home().props.user.id, 'other-tab');
  assert.equal(app.startup(), false);
});
