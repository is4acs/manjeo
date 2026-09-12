import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {prepareOrderRequest, restoreOrderRequest} from '../lib/checkout-request.ts';
import {writePendingOrder, clearPendingOrder, orderMatchesCart, orderRequestStorageKey} from '../app/checkout-state.ts';

const compile = source => ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}}).outputText;
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = [];
function findOrder(node) {
  if (ts.isFunctionDeclaration(node) && ['placeOrder', 'sendOrder', 'resumeOrder'].includes(node.name?.text)) handlers.push(node.getText(ast));
  ts.forEachChild(node, findOrder);
}
findOrder(ast);
assert.equal(handlers.length, 3, 'Execute the real submission and recovery handlers.');
const submitJavascript = compile(handlers.join('\n'));
const apiJavascript = compile(readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8'));
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const firstProof = 'a'.repeat(43);
const freshProof = 'b'.repeat(43);

function checkout(rejection, options = {}) {
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
        : [200, {order: {id: 'MJ-TEST', customerId: 'customer-a', status: options.status || 'pending'}}];
      return new Response(JSON.stringify(payload), {status, headers: {'Content-Type':'application/json'}});
    },
  });
  const noop = () => {};
  const context = vm.createContext({
    ...exports, prepareOrderRequest, restoreOrderRequest, writePendingOrder, clearPendingOrder, orderMatchesCart,
    savedAddressMatches: (saved, address, city) => !!saved && saved.address === address.trim() && saved.city === city && Date.parse(saved.verificationExpiresAt) > Date.now(),
    accountSession: {current: {id: 'customer-a', generation: 0}},
    crypto: {randomUUID: () => ++allocated === 1 ? firstId : secondId},
    sessionStorage: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    cartRestaurant: {id: 'restaurant-a'}, cartUnavailable: false, cartOutdated: false,
    updatingCart: false, promoPending: false, paymentReady: true,
    submittingRef: {current: false}, orderSequence: {current: 0}, request: {current: null},
    user: {id: 'customer-a', role: 'client', name: 'Camille Test', phone: '0694000001', deliveryAddress: {address: '7 Rue Lallouette', city: 'Cayenne', details: '', verificationExpiresAt: new Date(Date.now() + 60000).toISOString()}},
    activeUser: {current: 'customer-a'}, total: 1350, paymentMethod: 'demo', promotion: null,
    cart: [{productId: 'product-a', quantity: 1, selections: [], price: 1000, productVersion: 1}],
    address: '7 Rue Lallouette', city: 'Cayenne', details: '', notes: '',
    savedDelivery: false, confirmedCandidate: {verificationToken: firstProof, expiresAt: new Date(Date.now() + 60000).toISOString()}, appliedCode: '',
    setSubmitting: noop, setOrdersLoading: noop, setPendingRequest: value => {context.pendingRequest = value;},
    setOrderError: error => errors.push(error), setProfileSaveWarning: value => {context.profileSaveWarning = value;},
    setCurrentOrder: order => {context.currentOrder = order;}, setOrders: noop,
    setCart: value => {context.cart = typeof value === 'function' ? value(context.cart) : value;}, clearPromo: noop,
    setCartOpen: noop, setView: value => {context.view = value;}, refreshCatalog: async () => {},
    onSaveProfile: options.onSaveProfile || (async () => {}), openPayment: options.openPayment || (async () => {}),
  });
  vm.runInContext(submitJavascript, context);
  return {context, submitted, storage, errors, submit: () => context.request.current ? context.resumeOrder() : context.placeOrder(true)};
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
    assert.equal(JSON.parse(flow.storage.get(orderRequestStorageKey('customer-a'))).id, firstId);
    assert.equal(flow.context.submittingRef.current, false);
    await flow.submit();
    assert.deepEqual(flow.submitted.map(body => body.requestId), [firstId, firstId, firstId]);
    assert.deepEqual(flow.submitted[1], flow.submitted[0]);
    assert.deepEqual(flow.submitted[2], flow.submitted[0]);
    assert.equal(flow.submitted[2].addressVerificationToken, firstProof);
    assert.equal(flow.context.request.current, null);
    assert.equal(flow.storage.has(orderRequestStorageKey('customer-a')), false);
  });
}

test('only a confirmed order_not_created response clears the uncertain UUID and permits a fresh proof', async () => {
  const flow = checkout({status: 422, payload: {code: 'order_not_created'}});
  await flow.submit();
  flow.context.confirmedCandidate = {verificationToken: freshProof, expiresAt: new Date(Date.now() + 60000).toISOString()};
  await flow.submit();
  assert.equal(flow.context.request.current, null);
  assert.equal(flow.storage.has(orderRequestStorageKey('customer-a')), false);
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
  assert.equal(JSON.parse(flow.storage.get(orderRequestStorageKey('customer-a'))).id, firstId);
});

test('editing the draft after an uncertain response cannot create a new UUID before explicit recovery', async () => {
  const flow = checkout({status: 409});
  await flow.submit();
  flow.context.address = '19 Rue de la Liberté';
  flow.context.user.name = 'Destinataire différent';
  await flow.context.placeOrder(true);
  assert.equal(flow.submitted.length, 1);
  assert.equal(flow.context.request.current.id, firstId);
  assert.match(flow.errors.at(-1), /Reprenez la confirmation/);
});

test('recovery works with expired proof, unavailable restaurant and a changed basket without clearing that basket', async () => {
  const flow = checkout({status: 409});
  await flow.submit();
  flow.context.confirmedCandidate.expiresAt = '2000-01-01T00:00:00Z';
  flow.context.cartUnavailable = true;
  flow.context.cartOutdated = true;
  flow.context.cart[0].quantity = 2;
  await flow.submit();
  await flow.submit();
  assert.deepEqual(flow.submitted.map(body=>body.requestId), [firstId, firstId, firstId]);
  assert.equal(flow.context.cart[0].quantity, 2);
  assert.equal(flow.context.currentOrder.id, 'MJ-TEST');
});

test('a late order response from an earlier visit to the same account cannot clear the current basket', async () => {
  const flow = checkout({status: 409});
  let resolve;
  flow.context.api = () => new Promise(done=>{resolve=done;});
  const submission = flow.context.placeOrder(true);
  const attempt = flow.context.request.current;
  // The application rendered A, then B, then A again while the request was in flight.
  flow.context.accountSession.current = {id:'customer-a',generation:2};
  flow.context.cart[0].quantity = 3;
  resolve({order:{id:'MJ-OLD',customerId:'customer-a',status:'pending'}});
  await submission;
  assert.equal(flow.context.currentOrder, undefined);
  assert.equal(flow.context.cart[0].quantity, 3);
  assert.equal(flow.storage.has(orderRequestStorageKey('customer-a')), true, 'The returning account must recover the original order before its leftover basket can create another');
  assert.equal(attempt.id, firstId);
});

test('the synchronous submit guard prevents two clicks from sending two requests', async () => {
  const flow = checkout({status: 409});
  let resolve, calls = 0;
  flow.context.api = () => {calls++;return new Promise(done=>{resolve=done;});};
  const first = flow.context.placeOrder(true);
  await flow.context.placeOrder(true);
  await flow.context.resumeOrder();
  assert.equal(calls, 1);
  resolve({order:{id:'MJ-TEST',customerId:'customer-a',status:'pending'}});
  await first;
  assert.equal(flow.context.submittingRef.current, false);
});

test('profile autosave cannot delay payment or hide the order when it fails later', async () => {
  let failProfile, paymentCalls = 0;
  const flow = checkout({status: 409}, {onSaveProfile:()=>new Promise((_resolve,reject)=>{failProfile=reject;}),openPayment:async()=>{paymentCalls++;}});
  flow.context.api = async () => ({order:{id:'MJ-PAID',customerId:'customer-a',status:'awaiting_payment'}});
  const attempt = prepareOrderRequest(null, 'customer-a', {
    restaurantId:'restaurant-a', expectedTotal:1350, customerName:'Camille',phone:'0694000001',address:'7 Rue Lallouette',city:'Cayenne',details:'',notes:'',
    paymentMethod:'stripe',promoCode:null,items:[{productId:'product-a',quantity:1,unitPrice:1000,productVersion:1,selections:[]}],addressVerificationToken:firstProof,
  },()=>firstId);
  await flow.context.sendOrder(attempt, {name:'Camille'});
  assert.equal(paymentCalls, 1);
  assert.equal(flow.context.view, 'success');
  assert.equal(flow.context.submittingRef.current, false);
  assert.equal(flow.context.currentOrder.id, 'MJ-PAID');
  failProfile(new Error('Profile unavailable'));
  await Promise.resolve();
  assert.equal(flow.context.profileSaveWarning, 'MJ-PAID');
  assert.equal(flow.context.view, 'success');
});
