import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOrderRequest } from '../lib/checkout-request.ts';

const firstId = '11111111-1111-4111-8111-111111111111';
const nextId = '22222222-2222-4222-8222-222222222222';
const token = 'a'.repeat(43);
const body = () => ({restaurantId: 'ti-kreol', expectedTotal: 1350,
  customerName: 'Camille', phone: '0694000001', address: '7 Rue Lallouette', city: 'Cayenne', details: 'Portail bleu', notes: '',
  paymentMethod: 'demo', promoCode: null, items: [{productId: 'poulet', quantity: 1, unitPrice: 1100, productVersion: 2, selections: []}],
  addressVerificationToken: token});
const initial = () => prepareOrderRequest(null, 'client-a', body(), () => firstId);
const noNewId = () => { throw new Error('A retry must preserve the existing order identifier'); };

test('saving the verified address before retry preserves the exact first token payload', () => {
  const previous = initial();
  const current = {...body(), useDefaultAddress: true};
  delete current.addressVerificationToken;
  const retry = prepareOrderRequest(previous, 'client-a', current, noNewId);
  assert.equal(retry.id, firstId);
  assert.deepEqual(retry.payload, previous.payload);
  assert.equal(retry.payload.addressVerificationToken, token);
  assert.equal(retry.payload.useDefaultAddress, undefined);
});

test('a new verification token alone cannot duplicate an already submitted order', () => {
  const previous = initial();
  const retry = prepareOrderRequest(JSON.parse(JSON.stringify(previous)), 'client-a', {...body(), addressVerificationToken: 'b'.repeat(43)}, noNewId);
  assert.equal(retry.id, firstId);
  assert.equal(retry.payload.addressVerificationToken, token);
});

test('a business change starts a fresh attempt with the newly confirmed payload', () => {
  const previous = initial();
  for (const change of [{restaurantId: 'other'}, {expectedTotal: 1400}, {customerName: 'Autre'}, {phone: '0694000002'},
    {address: '8 Rue Lallouette'}, {city: 'Matoury'}, {details: 'Porte droite'}, {notes: 'Sans oignon'},
    {paymentMethod: 'stripe'}, {promoCode: 'PROMO'}, {items: [{...body().items[0], quantity: 2}]}]) {
    const payload = {...body(), ...change};
    const result = prepareOrderRequest(previous, 'client-a', payload, () => nextId);
    assert.equal(result.id, nextId, JSON.stringify(change));
    assert.deepEqual(result.payload, payload);
  }
});

test('another account never reuses the previous account identifier or confirmation token', () => {
  const payload = {...body(), addressVerificationToken: 'b'.repeat(43)};
  const result = prepareOrderRequest(initial(), 'client-b', payload, () => nextId);
  assert.equal(result.id, nextId);
  assert.equal(result.payload.addressVerificationToken, payload.addressVerificationToken);
});

test('malformed and legacy storage values cannot supply a pending order', () => {
  const previous = initial();
  const malformed = [null, [], 'bad', {}, {key: previous.key, id: firstId},
    {...previous, id: '../order'}, {...previous, payload: null},
    {...previous, payload: {...previous.payload, expectedTotal: 1}},
    {...previous, payload: {...previous.payload, addressVerificationToken: 'invalid'}},
    {...previous, payload: {...previous.payload, useDefaultAddress: true}},
    Object.create(previous),
  ];
  for (const value of malformed) {
    const result = prepareOrderRequest(value, 'client-a', body(), () => nextId);
    assert.equal(result.id, nextId);
    assert.deepEqual(result.payload, body());
  }
});

test('object property order is immaterial but nested price and selection changes matter', () => {
  const previous = initial();
  const reordered = Object.fromEntries(Object.entries(body()).reverse());
  reordered.items = [{selections: [], productVersion: 2, unitPrice: 1100, quantity: 1, productId: 'poulet'}];
  assert.equal(prepareOrderRequest(previous, 'client-a', reordered, noNewId).id, firstId);
  for (const change of [{unitPrice: 1200}, {productVersion: 3}, {selections: [{groupId: 'side', choiceIds: ['rice']}]}]) {
    const payload = {...body(), items: [{...body().items[0], ...change}]};
    assert.equal(prepareOrderRequest(previous, 'client-a', payload, () => nextId).id, nextId);
  }
});

test('caller mutation cannot modify an already captured request or a returned retry', () => {
  const payload = body();
  const previous = prepareOrderRequest(null, 'client-a', payload, () => firstId);
  payload.items[0].quantity = 9;
  assert.equal(previous.payload.items[0].quantity, 1);
  const retry = prepareOrderRequest(previous, 'client-a', body(), noNewId);
  retry.payload.items[0].quantity = 8;
  assert.equal(previous.payload.items[0].quantity, 1);
});

test('invalid account context is rejected before any identifier is allocated', () => {
  assert.throws(() => prepareOrderRequest(initial(), '', body(), noNewId), /account/);
});
