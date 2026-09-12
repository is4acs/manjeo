import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSelections, selectionsValid, selectionPrice, makeLine, lineNeedsUpdate, validStoredLine } from '../lib/cart.ts';

const product = { id: 'meal', name: 'Assiette test', description: '', price: 1200, group: 'Plats', version: 2, archived: false, available: true, allergens: '', optionGroups: [
  { id: 'size', name: 'Portion', min: 1, max: 1, choices: [{ id: 'regular', name: 'Classique', price: 0 }, { id: 'large', name: 'Grande', price: 200 }] },
  { id: 'extras', name: 'Suppléments', min: 0, max: 2, choices: [{ id: 'rice', name: 'Riz', price: 150 }, { id: 'sauce', name: 'Sauce', price: 50 }] },
] };
const selected = [{ groupId: 'size', choiceIds: ['large'] }, { groupId: 'extras', choiceIds: ['rice', 'sauce'] }];

test('required free default is valid and optional paid extras stay unselected', () => {
  const defaults = defaultSelections(product);
  assert.equal(selectionsValid(product, defaults), true);
  assert.equal(selectionPrice(product, defaults), 1200);
  assert.deepEqual(defaults[1].choiceIds, []);
  const paidOnly = { ...product, optionGroups: [{ ...product.optionGroups[0], choices: [product.optionGroups[0].choices[1]] }] };
  assert.equal(selectionsValid(paidOnly, defaultSelections(paidOnly)), false);
});

test('chosen supplements contribute once to the unit price and receipt', () => {
  const line = makeLine('restaurant', product, selected, 3);
  assert.equal(line.price, 1600);
  assert.equal(line.quantity, 3);
  assert.equal(line.option, 'Portion : Grande · Suppléments : Riz, Sauce');
  assert.equal(lineNeedsUpdate(line, product), false);
});

test('same option set merges regardless of click order; different options stay separate', () => {
  const reversed = [{ groupId: 'extras', choiceIds: ['sauce', 'rice'] }, selected[0]];
  assert.equal(makeLine('r', product, selected, 1).key, makeLine('r', product, reversed, 1).key);
  assert.notEqual(makeLine('r', product, selected, 1).key, makeLine('r', product, defaultSelections(product), 1).key);
});

test('missing, repeated, foreign and excessive choices cannot be ordered', () => {
  for (const invalid of [[], [{ groupId: 'size', choiceIds: ['unknown'] }], [selected[0], selected[0]], [{ groupId: 'size', choiceIds: ['large', 'regular'] }], [selected[0], { groupId: 'extras', choiceIds: ['rice', 'rice'] }], [...selected, { groupId: 'foreign', choiceIds: [] }], [null]]) {
    assert.equal(selectionsValid(product, invalid), false);
  }
});

test('published edits require cart review; withdrawn or missing meals cannot pass', () => {
  const line = makeLine('r', product, selected, 1);
  for (const changed of [undefined, { ...product, archived: true }, { ...product, available: false }, { ...product, version: 3 }, { ...product, price: 1300 }, { ...product, optionGroups: [product.optionGroups[0]] }]) {
    assert.equal(lineNeedsUpdate(line, changed), true);
  }
});

test('malformed and legacy browser carts are rejected without throwing', () => {
  const line = makeLine('r', product, selected, 1);
  assert.equal(validStoredLine(line), true);
  for (const invalid of [null, [], 'text', {}, { ...line, productVersion: undefined }, { ...line, quantity: 0 }, { ...line, quantity: 21 }, { ...line, price: NaN }, { ...line, selections: [null] }, { ...line, selections: [{ groupId: 'size', choiceIds: [1] }] }]) {
    assert.equal(validStoredLine(invalid), false);
  }
});

// Adding an optional group must not split the same server-side order line.
test('empty optional groups normalize to the same cart key after a menu edit', () => {
  const required = [selected[0]];
  const withEmpty = [...required, { groupId: 'extras', choiceIds: [] }];
  assert.equal(makeLine('r', product, required, 1).key, makeLine('r', product, withEmpty, 1).key);
});
