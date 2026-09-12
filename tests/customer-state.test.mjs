import test from 'node:test';
import assert from 'node:assert/strict';
import { promotionContext, quotedDiscount, shouldAdoptProfileLocation } from '../app/customer-state.ts';
import { remainingSeconds, countdown, clockLabel, isLate } from '../app/delivery-time.ts';

const basket = {userId: 'client-a', role: 'client', restaurantId: 'ti-kreol', city: 'Cayenne', subtotal: 2000, delivery: 250};
const context = promotionContext(basket);
const quote = {context, promotion: {code: 'BIENVENUE', discount: 400}};
const profileLocation = {userId: 'client-a', address: '7 Rue Lallouette', city: 'Cayenne', details: 'Portail bleu'};

test('a profile refresh updates an untouched checkout destination', () => {
  const updated = {...profileLocation, address: '9 Rue Lallouette', details: 'Entrée à droite'};
  assert.equal(shouldAdoptProfileLocation(profileLocation, updated, {...profileLocation}, true), true);
});

test('an address, town or delivery-details draft survives profile updates from another tab', () => {
  const updated = {...profileLocation, address: '9 Rue Lallouette', details: 'Adresse autre appareil'};
  for (const change of [{address: '18 Rue du Brouillon'}, {city: 'Matoury'}, {details: 'Bâtiment ajouté ici'}]) {
    const draft = {...profileLocation, ...change};
    assert.equal(shouldAdoptProfileLocation(profileLocation, updated, draft, true), false, JSON.stringify(change));
    // A later refresh must not mistake the unaccepted server address for our draft.
    assert.equal(shouldAdoptProfileLocation(updated, {...updated, address: '11 Rue Lallouette'}, draft, true), false);
  }
});

test('changing accounts adopts the new saved destination, while a first empty profile keeps a guest draft', () => {
  const nextAccount = {...profileLocation, userId: 'client-b', address: '20 Avenue de la Liberté'};
  const localDraft = {...profileLocation, address: '18 Rue du Brouillon'};
  assert.equal(shouldAdoptProfileLocation(profileLocation, nextAccount, localDraft, true), true);
  assert.equal(shouldAdoptProfileLocation(null, nextAccount, localDraft, true), true);
  assert.equal(shouldAdoptProfileLocation(null, {...nextAccount, address: '', city: 'Cayenne', details: ''}, localDraft, false), false);
});

test('removing the saved address clears an untouched destination but preserves a delivery draft', () => {
  const removed = {...profileLocation, address: '', city: 'Cayenne', details: ''};
  assert.equal(shouldAdoptProfileLocation(profileLocation, removed, profileLocation, false), true);
  assert.equal(shouldAdoptProfileLocation(profileLocation, removed, {...profileLocation, details: 'Instructions locales'}, false), false);
});

test('a checked promotion applies only to its exact account, restaurant and price snapshot', () => {
  assert.equal(quotedDiscount(quote, context, 'BIENVENUE', 2250), 400);
  for (const changed of [{userId: 'client-b'}, {role: 'restaurant'}, {restaurantId: 'another'}, {city: 'Matoury'}, {subtotal: 2500}, {delivery: 350}]) {
    assert.equal(quotedDiscount(quote, promotionContext({...basket, ...changed}), 'BIENVENUE', 3000), 0, JSON.stringify(changed));
  }
});

test('removing or replacing a promotion makes its delayed response unusable', () => {
  assert.equal(quotedDiscount(quote, context, '', 2250), 0);
  assert.equal(quotedDiscount(quote, context, 'LIVRAISON', 2250), 0);
  assert.equal(quotedDiscount(null, context, 'BIENVENUE', 2250), 0);
  assert.equal(quotedDiscount(quote, promotionContext({...basket, subtotal: 0}), 'BIENVENUE', 250), 0);
});

test('malformed quotes cannot add a charge or create a negative payable total', () => {
  for (const discount of [-1, NaN, 5.5]) assert.equal(quotedDiscount({...quote, promotion: {...quote.promotion, discount}}, context, 'BIENVENUE', 2250), 0);
  assert.equal(quotedDiscount({...quote, promotion: {...quote.promotion, discount: 3000}}, context, 'BIENVENUE', 2250), 2250);
});

test('deadline countdown never declares expiry before the final millisecond', () => {
  const target = Date.parse('2026-09-12T12:10:00Z');
  assert.equal(remainingSeconds('2026-09-12T12:10:00Z', target - 600000), 600);
  assert.equal(remainingSeconds('2026-09-12T12:10:00Z', target - 1), 1);
  assert.equal(remainingSeconds('2026-09-12T12:10:00Z', target), 0);
  assert.equal(remainingSeconds('2026-09-12T12:10:00Z', target + 1), 0);
  assert.equal(countdown(600), '10:00');
  assert.equal(countdown(61), '1:01');
});

test('invalid and absent dates stay readable; estimates use Cayenne time on every device', () => {
  for (const invalid of [undefined, null, '', 'invalid']) assert.equal(remainingSeconds(invalid), 0);
  assert.equal(countdown(NaN), '0:00');
  assert.equal(clockLabel('invalid'), 'Horaire indisponible');
  assert.equal(clockLabel('2026-09-12T12:10:00Z'), '09:10');
});

test('an overdue completed or cancelled order is never presented as still late', () => {
  const eta = '2026-09-12T12:10:00Z';
  const later = Date.parse(eta) + 60000;
  assert.equal(isLate(eta, 'picked_up', later), true);
  for (const status of ['delivered', 'cancelled']) assert.equal(isLate(eta, status, later), false);
  assert.equal(isLate('invalid', 'ready', later), false);
  assert.equal(isLate(eta, 'ready', Date.parse(eta) - 1), false);
});
