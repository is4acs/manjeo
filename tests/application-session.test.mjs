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

function harness({language = 'fr', explicitChoice = false} = {}) {
  const hooks = [], effects = [], requests = [], listeners = new Map();
  let cursor = 0, dirty = false, alive = true, tree, writesAfterUnmount = 0;
  let uiLanguage = language, chosenLanguage = explicitChoice;
  const normalizeLanguage = value => ['fr', 'ht', 'pt'].includes(value) ? value : null;
  const languageNames = {fr: 'français', ht: 'créole haïtien', pt: 'portugais', en: 'anglais', es: 'espagnol', gcr: 'créole guyanais', zh: 'chinois'};
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const slot = (kind, initial) => {
    const index = cursor++;
    if (!hooks[index]) hooks[index] = {kind, ...initial()};
    assert.equal(hooks[index].kind, kind, 'Hook ordering must stay valid between real component renders');
    return hooks[index];
  };
  const react = {
    lazy: () => components.Staff,
    Suspense: function Suspense() {},
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
  const components = Object.fromEntries(['Home', 'Staff', 'CustomerAccount', 'LanguageBar', 'Dialog', 'DialogContent', 'DialogDescription', 'DialogTitle', 'Button', 'Input'].map(name => [name, function component() {}]));
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
      if (name === '@/lib/i18n') return {
        t: (value, parameters = {}) => value.replace(/\{(\w+)\}/g, (_match, name) => parameters[name] || ''),
        documentLanguage: () => uiLanguage, getLanguage: () => uiLanguage, normalizeLanguage,
        languageOptions: ['fr', 'ht', 'pt'].map(code => ({code, label: languageNames[code]})),
      };
      if (name === './i18n') return {
        useLanguage: () => uiLanguage, hasLanguageChoice: () => chosenLanguage,
        adoptProfileLanguage(value) { if (!chosenLanguage && normalizeLanguage(value) && uiLanguage !== value) { uiLanguage = value; dirty = true; } },
        chooseLanguage(value) { chosenLanguage = true; uiLanguage = value; dirty = true; },
        LanguageBar: components.LanguageBar,
      };
      if (name === './translate') return {languageNames};
      if (name === './validation') return {refreshValidationLanguage() {}};
      if (name === './customer-account') return {default: components.CustomerAccount};
      if (name === './page') return {default: components.Home};
      if (name === './staff') return {default: components.Staff};
      return components;
    },
    window: {addEventListener, removeEventListener: (name, callback) => listeners.get(name)?.delete(callback), dispatchEvent: event => { for (const callback of listeners.get(event.type) || []) callback(event); }},
    Event,
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
    return [node, ...nodes(node.props?.children), ...((node.type === components.Home || node.type === components.Staff) ? nodes(node.props?.languageControl) : [])];
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
    staff: () => nodes(tree).find(node => node.type === components.Staff),
    find: predicate => nodes(tree).find(predicate),
    startup: () => !!nodes(tree).find(node => node.props?.className === 'app-startup'),
    button: label => nodes(tree).find(node => node.type === components.Button && node.props.children === label),
    chooseLanguage: value => nodes(tree).find(node => node.type === components.LanguageBar).props.onChange(value),
    get interfaceLanguage() { return uiLanguage; },
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

for (const name of ['storage', 'focus', 'manjeo-session-expired', 'manjeo-session-changed']) {
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

for (const language of ['en', 'es', 'gcr', 'zh']) {
  test(`legacy ${language} messaging target adopts the selected three-language interface`, async () => {
    const app = harness();
    const account = {...customer('legacy'), language};
    await settleInitial(app, account);
    assert.equal(app.home().props.user.language, 'fr');
    assert.equal(app.interfaceLanguage, 'fr');
    const request = app.take('/api/profile');
    assert.deepEqual(JSON.parse(request.options.body), {language:'fr'});
    request.resolve({user:{...account, language:'fr'}});
    await app.flush();
    app.home().props.onAccount(); await app.flush();
    assert.equal(app.find(node => node.type === 'select' && node.props.name === 'language'), undefined);
    assert.equal(app.requests.filter(item => item.path === '/api/profile').length, 1);
  });
}

test('an explicit main language choice immediately controls messages and saves only the language', async () => {
  const app = harness();
  const account = customer('first');
  await settleInitial(app, account);
  app.chooseLanguage('ht');
  const request = app.take('/api/profile');
  assert.deepEqual(JSON.parse(request.options.body), {language: 'ht'});
  await app.flush();
  assert.equal(app.interfaceLanguage, 'ht');
  assert.equal(app.home().props.user.language, 'ht');
  request.resolve({user: {...account, language: 'ht'}});
  await app.flush();
  assert.equal(app.requests.filter(item => item.path === '/api/profile').length, 1);
});

test('the language selected before login is saved to the account for another device', async () => {
  const app = harness({language:'pt', explicitChoice:true});
  await settleInitial(app, null);
  app.home().props.onAccount(); await app.flush();
  const form = app.find(node => node.type === 'form' && node.props.className === 'account-form');
  const login = form.props.onSubmit(event);
  app.take('/api/login').resolve({user:customer('signed-in')});
  await login; await app.flush();
  assert.equal(app.interfaceLanguage, 'pt');
  const request = app.take('/api/profile');
  assert.deepEqual(JSON.parse(request.options.body), {language:'pt'});
  request.resolve({user:{...customer('signed-in'), language:'pt'}});
  await app.flush();
  assert.equal(app.home().props.user.language, 'pt');
});

test('a saved supported account language is adopted on a device with no explicit choice', async () => {
  const app = harness();
  await settleInitial(app, {...customer('first'), language:'ht'});
  assert.equal(app.interfaceLanguage, 'ht');
  assert.equal(app.home().props.user.language, 'ht');
  assert.equal(app.requests.filter(item => item.path === '/api/profile').length, 0);
});

test('failed language persistence leaves the local choice and does not loop requests', async () => {
  const app = harness({language:'pt', explicitChoice:true});
  await settleInitial(app);
  app.take('/api/profile').reject(new Error('offline'));
  await app.flush();
  assert.equal(app.interfaceLanguage, 'pt');
  assert.equal(app.home().props.user.language, 'pt');
  assert.equal(app.requests.filter(item => item.path === '/api/profile').length, 1);
});

test('a stale language save cannot restore the previous account after another tab logs in', async () => {
  const app = harness();
  await settleInitial(app);
  app.chooseLanguage('ht');
  const stale = app.take('/api/profile');
  app.dispatch('storage');
  app.take('/api/session').resolve({user:{...customer('other'), language:'ht'}});
  await app.flush();
  stale.resolve({user:{...customer('first'), language:'ht'}});
  await app.flush();
  assert.equal(app.home().props.user.id, 'other');
});

test('checkout autosave and My account share one profile mutation lock', async () => {
  const app = harness();
  await settleInitial(app);
  const automaticSave = app.home().props.onSaveProfile({name:'Nom Automatique', language:'fr'});
  const automaticRequest = app.take('/api/profile');
  app.home().props.onAccount();
  await app.flush();
  const accountPanel = () => app.find(node => node.props?.onSaveProfile && typeof node.props.disabled === 'boolean');
  assert.equal(accountPanel().props.disabled, true, 'The account stays readable but cannot start a competing save');
  assert.equal(accountPanel().props.onSaveProfile, app.home().props.onSaveProfile);
  await assert.rejects(accountPanel().props.onSaveProfile({name:'Nom Manuel'}), /déjà en cours/);
  app.chooseLanguage('pt');
  assert.equal(app.interfaceLanguage, 'fr', 'The common lock also prevents a concurrent language save');
  assert.equal(app.requests.filter(request => request.path === '/api/profile').length, 1);
  automaticRequest.resolve({user:{...customer('first'), name:'Nom Automatique'}});
  await automaticSave; await app.flush();
  assert.equal(accountPanel().props.disabled, false);
  const manualSave = accountPanel().props.onSaveProfile({name:'Nom Manuel Plus Récent'});
  app.take('/api/profile').resolve({user:{...customer('first'), name:'Nom Manuel Plus Récent'}});
  await manualSave; await app.flush();
  assert.equal(app.home().props.user.name, 'Nom Manuel Plus Récent');
});

for (const refreshedAccount of [customer('first'), customer('another-account')]) {
  test(`a delayed checkout profile save cannot replace ${refreshedAccount.id} refreshed from another tab`, async () => {
    const app = harness();
    await settleInitial(app);
    const automaticSave = app.home().props.onSaveProfile({name:'Nom Automatique Ancien'});
    const refused = assert.rejects(automaticSave, /compte connecté a changé/);
    const automaticRequest = app.take('/api/profile');
    app.dispatch('storage');
    app.take('/api/session').resolve({user:{...refreshedAccount, name:'Nom Récent Autre Onglet'}});
    await app.flush();
    automaticRequest.resolve({user:{...customer('first'), name:'Nom Automatique Ancien'}});
    await refused; await app.flush();
    assert.equal(app.home().props.user.id, refreshedAccount.id);
    assert.equal(app.home().props.user.name, 'Nom Récent Autre Onglet');
  });
}

test('a checkout profile save that finishes after unmount cannot publish any state', async () => {
  const app = harness();
  await settleInitial(app);
  const save = app.home().props.onSaveProfile({name:'Réponse Tardive'});
  const refused = assert.rejects(save, /compte connecté a changé/);
  const request = app.take('/api/profile');
  app.unmount();
  request.resolve({user:{...customer('first'), name:'Réponse Tardive'}});
  await refused; await app.flush();
  assert.equal(app.writesAfterUnmount, 0);
});

test('a server account mismatch rechecks the session even while a profile save holds the mutation lock', async () => {
  const app = harness(); await settleInitial(app);
  const save = app.home().props.onSaveProfile({phone:'0694000042'});
  const refused = assert.rejects(save, /compte connecté a changé/);
  const request = app.take('/api/profile');
  assert.equal(request.options.accountId, 'first');
  app.dispatch('manjeo-session-changed');
  request.reject(new Error('Le compte connecté a changé. Réessayez.'));
  app.take('/api/session').resolve({user: customer('current-cookie-owner')});
  await refused; await app.flush();
  assert.equal(app.home().props.user.id, 'current-cookie-owner');
  assert.equal(app.requests.filter(request => request.path === '/api/profile').length, 1);
});

for (const eventName of ['storage', 'manjeo-session-changed']) {
  test(`${eventName} during login triggers a final read after the login response can change the cookie`, async () => {
    const app = harness(); await settleInitial(app, null);
    app.home().props.onAccount(); await app.flush();
    const operation = app.find(node => node.type === 'form' && node.props.className === 'account-form').props.onSubmit(event);
    const login = app.take('/api/login');
    app.dispatch(eventName);
    app.take('/api/session').resolve({user: customer('cookie-before-login-response')});
    await app.flush();
    login.resolve({user: customer('cookie-after-login-response')});
    await operation; await app.flush();
    app.take('/api/session').resolve({user: customer('cookie-after-login-response')});
    await app.flush();
    assert.equal(app.home().props.user.id, 'cookie-after-login-response');
    assert.equal(app.requests.filter(request => request.path === '/api/login').length, 1);
  });
}

test('a professional changes only their phone while a fresh name from another device is preserved', async () => {
  const app = harness();
  const account = {...customer('admin'), role: 'admin', name: 'Nom initial', phone: '0694000001'};
  await settleInitial(app, account);
  app.staff().props.onAccount(); await app.flush();
  app.find(node => node.props?.name === 'phone').props.onChange({target: {value: '0694000002'}}); await app.flush();
  app.dispatch('focus');
  app.take('/api/session').resolve({user: {...account, name: 'Nom actualisé ailleurs'}}); await app.flush();
  assert.equal(app.find(node => node.props?.name === 'name').props.value, 'Nom actualisé ailleurs');
  assert.equal(app.find(node => node.props?.name === 'phone').props.value, '0694000002');
  const save = app.find(node => node.type === 'form' && node.props.className === 'account-form profile-form').props.onSubmit(event);
  const request = app.take('/api/profile');
  assert.deepEqual(JSON.parse(request.options.body), {phone: '0694000002'});
  assert.equal(request.options.accountId, account.id);
  request.resolve({user: {...account, name: 'Nom actualisé ailleurs', phone: '0694000002'}});
  await save; await app.flush();
  assert.equal(app.staff().props.user.name, 'Nom actualisé ailleurs');
});
