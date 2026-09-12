import test from 'node:test';
import assert from 'node:assert/strict';
import { promotionContext, quotedDiscount } from '../app/customer-state.ts';
import { remainingSeconds, countdown, clockLabel, isLate } from '../app/delivery-time.ts';

const basket = {userId: 'client-a', role: 'client', restaurantId: 'ti-kreol', city: 'Cayenne', subtotal: 2000, delivery: 250};
const context = promotionContext(basket);
const quote = {context, promotion: {code: 'BIENVENUE', discount: 400}};

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
