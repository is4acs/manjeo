import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cheapestDelivery, cheapestDeliveryCount, conditionParts, endsSoon,
  houseOffers, offersByRestaurant, startingOffer,
} from '../lib/offers.ts';

const promotion = (overrides = {}) => ({
  code: 'CODE', label: 'Une offre', conditions: '', restaurantId: null,
  minimum: 0, kind: 'percent', value: 20, endsAt: '2030-12-31T23:59:59Z', ...overrides,
});

const restaurant = (overrides = {}) => ({
  id: 'resto', name: 'Resto', description: '', category: 'Créole', image: '', imageAlt: '',
  tag: '', rating: 4.5, minutes: 25, delivery: 250, from: 0, acceptingOrders: true,
  menuVersion: 1, categories: ['Les plats', 'Les petits plus'], pickupAddress: '', pickupCity: 'Cayenne',
  products: [
    {id: 'plat', name: 'Plat', description: '', price: 1100, group: 'Les plats', available: true, version: 1, archived: false, allergens: '', optionGroups: []},
    {id: 'jus', name: 'Jus', description: '', price: 350, group: 'Les petits plus', available: true, version: 1, archived: false, allergens: '', optionGroups: []},
  ],
  ...overrides,
});

test('one offer per restaurant, and only codes reserved to an address make a flag', () => {
  const offers = offersByRestaurant([
    promotion({code: 'PARTOUT', restaurantId: null}),
    promotion({code: 'PREMIER', restaurantId: 'resto'}),
    promotion({code: 'SECOND', restaurantId: 'resto'}),
  ]);
  assert.deepEqual([...offers.keys()], ['resto']);
  assert.equal(offers.get('resto').code, 'PREMIER');
  assert.deepEqual(houseOffers([
    promotion({code: 'PARTOUT', restaurantId: null}),
    promotion({code: 'PREMIER', restaurantId: 'resto'}),
  ]).map(offer => offer.code), ['PARTOUT']);
});

test('the struck price only appears when the discount really applies to a single dish', () => {
  const resto = restaurant();
  // 20 % de 11,00 € = 2,20 € — le barème du serveur, arrondi vers le bas.
  assert.deepEqual(startingOffer(resto, promotion({kind: 'percent', value: 20})), {price: 880, previous: 1100});
  assert.deepEqual(startingOffer(resto, promotion({kind: 'amount', value: 500})), {price: 600, previous: 1100});
  // Minimum de commande non atteint par un seul plat : aucun prix barré.
  assert.equal(startingOffer(resto, promotion({kind: 'amount', value: 500, minimum: 2000})), null);
  // Une livraison offerte ne change aucun prix de plat.
  assert.equal(startingOffer(resto, promotion({kind: 'delivery', value: 0})), null);
  assert.equal(startingOffer(resto, undefined), null);
});

test('the starting price ignores the drinks of the side menu', () => {
  assert.equal(startingOffer(restaurant(), promotion({kind: 'amount', value: 100})).previous, 1100);
});

test('the cheapest delivery is read from the restaurants that actually take orders', () => {
  const open = [restaurant({id: 'a', delivery: 250}), restaurant({id: 'b', delivery: 200}), restaurant({id: 'c', delivery: 200})];
  assert.equal(cheapestDelivery(open), 200);
  assert.equal(cheapestDeliveryCount(open), 2);
  const paused = [restaurant({id: 'a', delivery: 250}), restaurant({id: 'b', delivery: 100, acceptingOrders: false})];
  assert.equal(cheapestDelivery(paused), 250);
  assert.equal(cheapestDelivery([]), 0);
});

test('only a deadline within the fortnight is worth dating on a card', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  assert.equal(endsSoon(promotion({endsAt: '2026-09-20T12:00:00Z'}), now), true);
  assert.equal(endsSoon(promotion({endsAt: '2030-12-31T23:59:59Z'}), now), false);
  assert.equal(endsSoon(promotion({endsAt: '2026-09-01T12:00:00Z'}), now), false);
  assert.equal(endsSoon(promotion({endsAt: 'pas une date'}), now), false);
});

test('server conditions split into parts that can each be translated', () => {
  assert.deepEqual(conditionParts('dès 20,00 € · chez ce restaurant uniquement'),
                   ['dès 20,00 €', 'chez ce restaurant uniquement']);
  assert.deepEqual(conditionParts(''), []);
});

test('the short badge summarises the real terms instead of repeating the restaurant name', async () => {
  const {offerBadge, cardConditions} = await import('../lib/offers.ts');
  assert.deepEqual(offerBadge(promotion({kind: 'percent', value: 15})), {source: '−{value} %', params: {value: 15}});
  assert.equal(offerBadge(promotion({kind: 'amount', value: 300})).source, '−{price}');
  assert.equal(offerBadge(promotion({kind: 'delivery'})).source, 'Livraison offerte');
  // Sur la carte d'un restaurant, « chez ce restaurant uniquement » est déjà dit par la carte.
  assert.deepEqual(cardConditions('dès 12,00 € · chez ce restaurant uniquement · 2 utilisations par compte'),
                   ['dès 12,00 €', '2 utilisations par compte']);
});
