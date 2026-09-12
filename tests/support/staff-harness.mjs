import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// Render the actual component and its hooks, controlling HTTP completion order.
// Children stay as JSX nodes so tests interact with their real handlers/props.
export function staffHarness(file, initialProps, {dashboard = false, componentName, translate, stored = {}, globals = {}} = {}) {
  const hooks = [], effects = [], requests = [], listeners = new Map(), intervals = new Set();
  const storage = new Map(Object.entries(stored));
  let cursor = 0, dirty = false, alive = true, tree, props = initialProps;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const slot = (kind, initial) => {
    const index = cursor++;
    if (!hooks[index]) hooks[index] = {kind, ...initial()};
    assert.equal(hooks[index].kind, kind);
    return hooks[index];
  };
  const react = {
    useState(initial) {
      const hook = slot('state', () => ({value: typeof initial === 'function' ? initial() : initial}));
      return [hook.value, value => {
        const next = typeof value === 'function' ? value(hook.value) : value;
        if (!Object.is(next, hook.value)) {hook.value = next; dirty = true;}
      }];
    },
    useRef(initial) {return slot('ref', () => ({value: {current: initial}})).value;},
    useCallback(callback, dependencies) {
      const hook = slot('callback', () => ({}));
      if (!same(hook.dependencies, dependencies)) {hook.value = callback; hook.dependencies = dependencies;}
      return hook.value;
    },
    useMemo(factory, dependencies) {
      const hook = slot('memo', () => ({}));
      if (!same(hook.dependencies, dependencies)) {hook.value = factory(); hook.dependencies = dependencies;}
      return hook.value;
    },
    useEffect(effect, dependencies) {
      const hook = slot('effect', () => ({}));
      if (!same(hook.dependencies, dependencies)) {
        hook.dependencies = dependencies;
        effects.push(() => {hook.cleanup?.(); hook.cleanup = effect();});
      }
    },
  };
  const components = new Proxy({}, {get: (target, name) => target[name] ||= function component() {}});
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(`../../app/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
  }).outputText;
  const events = {
    addEventListener(name, callback) {if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback);},
    removeEventListener(name, callback) {listeners.get(name)?.delete(callback);},
  };
  vm.runInNewContext(source + (componentName ? `\nexports.testComponent = ${componentName};` : ''), {
    exports, Error,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return {jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props})};
      if (name === '@/lib/api') return {ApiError, statusLabels: new Proxy({}, {get: (_, name) => name}), api(path, options = {}) {
        return new Promise((resolve, reject) => requests.push({path, options, resolve, reject, taken: false}));
      }};
      if (name === '@/lib/i18n') return {t: translate || ((value, params = {}) => value.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '')), tEvent: value => value, formatDate: value => value};
      if (name === '@/lib/menu') return {money: value => String(value)};
      return components;
    },
    window: {...events, setTimeout() {return 1;}, clearTimeout() {}, setInterval(callback) {intervals.add(callback); return callback;}, clearInterval(callback) {intervals.delete(callback);}},
    document: {...events, visibilityState: 'visible'},
    sessionStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    crypto: {randomUUID: () => 'new-id'},
    ...globals,
  });
  function render() {
    cursor = 0; dirty = false;
    tree = componentName ? exports.testComponent(props) : dashboard ? exports.default(props).type(props) : exports.default(props);
    while (effects.length) effects.shift()();
  }
  async function flush() {
    for (let round = 0; round < 12; round++) {
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty || !alive) return;
      render();
    }
    throw new Error('Staff component did not settle');
  }
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children)];
  }
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
  render();
  return {
    requests, storage, flush,
    take(path, method = 'GET') {
      const request = requests.find(item => !item.taken && item.path === path && (item.options.method || 'GET') === method);
      assert.ok(request, `Expected ${method} ${path}`); request.taken = true; return request;
    },
    find: predicate => nodes(tree).find(predicate),
    all: predicate => nodes(tree).filter(predicate),
    button: label => nodes(tree).find(node => node.type === 'button' && text(node) === label),
    field(label) {
      const wrapper = nodes(tree).find(node => node.type === 'label' && (Array.isArray(node.props.children) ? node.props.children[0] : undefined) === label);
      return nodes(wrapper).find(node => ['input', 'textarea', 'select'].includes(node.type));
    },
    get text() {return text(tree);},
    updateProps(next) {props = {...props, ...next}; render();},
    tick() {for (const callback of intervals) callback();},
    dispatch(name, detail) {for (const callback of listeners.get(name) || []) callback({detail});},
    unmount() {alive = false; for (const hook of hooks) hook.cleanup?.();},
  };
}

export const formEvent = {preventDefault() {}};
export const change = value => ({target: {value}});
