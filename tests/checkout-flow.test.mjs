import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {prepareOrderRequest} from '../lib/checkout-request.ts';

const compile = source => ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}}).outputText;
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let placeOrder;
function findOrder(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'placeOrder') placeOrder = node.getText(ast);
  ts.forEachChild(node, findOrder);
}
findOrder(ast);
assert.ok(placeOrder, 'The test must execute the actual checkout submit handler.');
const submitJavascript = compile(placeOrder);
const apiJavascript = compile(readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8'));
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const firstProof = 'a'.repeat(43);
const freshProof = 'b'.repeat(43);

function checkout(rejection) {
  const submitted = [];
  const storage = new Map();
  const errors = [];
  let sequence = 0;
  let allocated = 0;
  const exports = {};
  vm.runInNewContext(apiJavascript, {
    exports, AbortController, Event,
    window: {setTimeout, clearTimeout, dispatchEvent() {}},
    async fetch(path, options) {
      assert.equal(path, '/api/orders');
      submitted.push(JSON.parse(options.body));
      if (++sequence === 1) throw new TypeError('The first response was lost.');
      const [status, payload] = sequence === 2
        ? [rejection.status, {error: 'Réessayez.', ...rejection.payload}]
        : [200, {order: {id: 'MJ-TEST', status: 'pending'}}];
      return new Response(JSON.stringify(payload), {status, headers: {'Content-Type':'application/json'}});
    },
  });
  const noop = () => {};
  const context = vm.createContext({
    ...exports, prepareOrderRequest,
    crypto: {randomUUID: () => ++allocated === 1 ? firstId : secondId},
    sessionStorage: {setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    cartRestaurant: {id: 'restaurant-a'}, cartUnavailable: false, cartOutdated: false,
    updatingCart: false, promoPending: false, paymentReady: true,
    submittingRef: {current: false}, orderSequence: {current: 0}, request: {current: null},
    user: {id: 'customer-a', role: 'client', name: 'Camille Test', phone: '0694000001', deliveryAddress: {details: ''}},
    activeUser: {current: 'customer-a'}, total: 1350, paymentMethod: 'demo', promotion: null,
    cart: [{productId: 'product-a', quantity: 1, selections: {}, price: 1000, productVersion: 1}],
    address: '7 Rue Lallouette', city: 'Cayenne', details: '', notes: '',
    savedDelivery: false, confirmedCandidate: {verificationToken: firstProof}, appliedCode: '',
    setSubmitting: noop, setOrderError: error => errors.push(error), setProfileSaveWarning: noop,
    setCurrentOrder: noop, setOrders: noop, setCart: noop, clearPromo: noop,
    setCartOpen: noop, setView: noop, refreshCatalog: async () => {},
  });
  vm.runInContext(submitJavascript, context);
  return {context, submitted, storage, errors, submit: () => context.placeOrder(true)};
}

for (const status of [401, 403, 408, 409, 429]) {
  test(`checkout preserves the original UUID and body after a lost response followed by HTTP ${status}`, async () => {
    const flow = checkout({status});
    await flow.submit();
    assert.equal(flow.context.request.current.id, firstId);
    // An address can become a saved default while the first result is uncertain.
    flow.context.confirmedCandidate = null;
    flow.context.savedDelivery = true;
    await flow.submit();
    assert.equal(flow.context.request.current.id, firstId);
    assert.equal(JSON.parse(flow.storage.get('manjeo-request-v1')).id, firstId);
    assert.equal(flow.context.submittingRef.current, false);
    await flow.submit();
    assert.deepEqual(flow.submitted.map(body => body.requestId), [firstId, firstId, firstId]);
    assert.deepEqual(flow.submitted[1], flow.submitted[0]);
    assert.deepEqual(flow.submitted[2], flow.submitted[0]);
    assert.equal(flow.submitted[2].addressVerificationToken, firstProof);
    assert.equal(flow.context.request.current, null);
    assert.equal(flow.storage.has('manjeo-request-v1'), false);
  });
}

test('only a confirmed order_not_created response clears the uncertain UUID and permits a fresh proof', async () => {
  const flow = checkout({status: 422, payload: {code: 'order_not_created'}});
  await flow.submit();
  flow.context.confirmedCandidate = {verificationToken: freshProof};
  await flow.submit();
  assert.equal(flow.context.request.current, null);
  assert.equal(flow.storage.has('manjeo-request-v1'), false);
  await flow.submit();
  assert.deepEqual(flow.submitted.map(body => body.requestId), [firstId, firstId, secondId]);
  assert.equal(flow.submitted[1].addressVerificationToken, firstProof);
  assert.equal(flow.submitted[2].addressVerificationToken, freshProof);
});

test('an unrelated server error code does not release an uncertain order UUID', async () => {
  const flow = checkout({status: 400, payload: {code: 'invalid_request'}});
  await flow.submit();
  await flow.submit();
  assert.equal(flow.context.request.current.id, firstId);
  assert.equal(JSON.parse(flow.storage.get('manjeo-request-v1')).id, firstId);
});
