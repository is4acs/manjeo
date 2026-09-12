import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOrderRequest, restoreOrderRequest} from '../lib/checkout-request.ts';
import {readPendingOrder, writePendingOrder, clearPendingOrder, orderRequestStorageKey, orderMatchesCart} from '../app/checkout-state.ts';

const firstId = '11111111-1111-4111-8111-111111111111';
const nextId = '22222222-2222-4222-8222-222222222222';
const body = {restaurantId:'ti-kreol', customerName:'Camille', phone:'0694000001', address:'7 Rue Lallouette', city:'Cayenne',
  details:'Portail bleu', notes:'Ne pas sonner', paymentMethod:'demo', promoCode:null, expectedTotal:1350,
  addressVerificationToken:'a'.repeat(43), items:[{productId:'poulet',quantity:1,unitPrice:1100,productVersion:2,selections:[{groupId:'portion',choiceIds:['classique']}]}]};
const pending = (account = 'client-a', id = firstId, payload = body) => prepareOrderRequest(null, account, payload, () => id);
function memory() {
  const values = new Map();
  return {values, getItem:key=>values.get(key) || null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key)};
}

test('pending requests remain separate across client A → B → A and preserve every original field', () => {
  const storage = memory();
  const a = pending();
  const b = pending('client-b', nextId, {...body, customerName:'Autre compte', notes:'Autres instructions'});
  writePendingOrder(storage, 'client-a', a);
  assert.equal(readPendingOrder(storage, 'client-b'), null);
  writePendingOrder(storage, 'client-b', b);
  assert.deepEqual(readPendingOrder(storage, 'client-a'), a);
  assert.deepEqual(readPendingOrder(storage, 'client-b'), b);
  clearPendingOrder(storage, 'client-b', nextId);
  assert.deepEqual(readPendingOrder(storage, 'client-a'), a);
});

test('a valid v1 request migrates only when its owner returns', () => {
  const storage = memory(), original = pending();
  storage.setItem('manjeo-request-v1', JSON.stringify(original));
  assert.equal(readPendingOrder(storage, 'client-b'), null);
  assert.ok(storage.getItem('manjeo-request-v1'));
  assert.deepEqual(readPendingOrder(storage, 'client-a'), original);
  assert.equal(storage.getItem('manjeo-request-v1'), null);
  assert.deepEqual(JSON.parse(storage.getItem(orderRequestStorageKey('client-a'))), original);
});

test('a late acknowledgement cannot remove a newer request from the same account', () => {
  const storage = memory(), newer = pending('client-a', nextId);
  writePendingOrder(storage, 'client-a', newer);
  clearPendingOrder(storage, 'client-a', firstId);
  assert.deepEqual(readPendingOrder(storage, 'client-a'), newer);
});

test('blocked storage does not hide a valid legacy retry or turn acknowledgement into failure', () => {
  const original = pending();
  const unavailable = {getItem: () => JSON.stringify(original), setItem() {throw new Error('Quota');}, removeItem() {throw new Error('Blocked');}};
  assert.deepEqual(readPendingOrder(unavailable, 'client-a'), original);
  assert.doesNotThrow(() => writePendingOrder(unavailable, 'client-a', original));
  assert.doesNotThrow(() => clearPendingOrder(unavailable, 'client-a', firstId));
});

test('corrupt account storage falls back to a valid owned legacy request', () => {
  const storage = memory(), original = pending();
  storage.setItem(orderRequestStorageKey('client-a'), '{broken');
  storage.setItem('manjeo-request-v1', JSON.stringify(original));
  assert.deepEqual(readPendingOrder(storage, 'client-a'), original);
});

test('malformed JSON, cross-account values and inconsistent or unsupported payloads are never resumed', () => {
  const original = pending();
  for (const value of ['{broken', 'null', '[]', JSON.stringify(pending('client-b')),
    JSON.stringify({...original, payload:{...body, expectedTotal:1}}),
    JSON.stringify(pending('client-a', firstId, {...body, items:null})),
    JSON.stringify(pending('client-a', firstId, {...body, phone:{value:'0694000001'}})),
    JSON.stringify(pending('client-a', firstId, {...body, items:[{...body.items[0], selections:'old-options'}]})),
  ]) {
    const storage = memory(); storage.setItem(orderRequestStorageKey('client-a'), value);
    assert.equal(readPendingOrder(storage, 'client-a'), null, value);
  }
  assert.equal(restoreOrderRequest(Object.create(original), 'client-a'), null);
});

test('resumed payload is detached from both the cache object and other accounts', () => {
  const original = pending();
  const copy = restoreOrderRequest(original, 'client-a');
  copy.payload.items[0].quantity = 20;
  assert.equal(original.payload.items[0].quantity, 1);
  assert.equal(restoreOrderRequest(original, 'client-b'), null);
});

const cart = body.items.map(item => ({...item, restaurantId:body.restaurantId, price:item.unitPrice}));
test('only the basket represented by the recovered request can be cleared', () => {
  assert.equal(orderMatchesCart(body, cart), true);
  for (const change of [{restaurantId:'other'}, {productId:'another'}, {quantity:2}, {price:1200}, {productVersion:3}, {selections:[]}]) {
    assert.equal(orderMatchesCart(body, [{...cart[0],...change}]), false, JSON.stringify(change));
  }
  assert.equal(orderMatchesCart(body, []), false);
  assert.equal(orderMatchesCart({...body,items:[null]}, cart), false);
});

test('equivalent option order does not leave a duplicate of the confirmed basket', () => {
  const selections = [{groupId:'extras',choiceIds:['b','a']},{groupId:'portion',choiceIds:['classique']}];
  const payload = {...body,items:[{...body.items[0], selections}]};
  assert.equal(orderMatchesCart(payload,[{...cart[0],selections:[{groupId:'portion',choiceIds:['classique']},{groupId:'extras',choiceIds:['a','b']}]}]),true);
});
