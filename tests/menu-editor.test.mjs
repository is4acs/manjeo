import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError, change, formEvent, staffHarness} from './support/staff-harness.mjs';

const restaurant = {id: 'kaz', name: 'La Kaz', description: 'Cuisine maison', minutes: 25, pickupAddress: '7 rue ancienne', pickupCity: 'Cayenne', acceptingOrders: true};
const menu = {version: 2, categories: ['Plats'], products: [{id: 'dish', name: 'Riz', description: '', group: 'Plats', price: 1000, available: true, archived: false, allergens: '', image: '', optionGroups: [], version: 1}]};

async function editor(options = {}) {
  const changes = [];
  const app = staffHarness('menu-editor.tsx', {restaurant, onRestaurantChange: (...args) => changes.push(args)}, options);
  app.take('/api/restaurants/kaz/menu').resolve({menu});
  await app.flush();
  return {app, changes};
}
const profileForm = app => app.all(node => node.type === 'form').at(-1);

test('restaurant updates refresh untouched fields and preserve an in-progress profile edit', async () => {
  const {app} = await editor();
  app.field('Présentation').props.onChange(change('Mon nouveau texte'));
  await app.flush();
  app.updateProps({restaurant: {...restaurant, name: 'La Kaz nouvelle', pickupAddress: '9 rue corrigée', minutes: 30}});
  await app.flush();
  assert.equal(app.field('Nom du restaurant').props.value, 'La Kaz nouvelle');
  assert.equal(app.field('Adresse de retrait').props.value, '9 rue corrigée');
  assert.equal(app.field('Présentation').props.value, 'Mon nouveau texte');
  void profileForm(app).props.onSubmit(formEvent);
  const request = app.take('/api/restaurants/kaz', 'PATCH');
  assert.deepEqual(JSON.parse(request.options.body), {description: 'Mon nouveau texte'}, 'Only intentional edits may overwrite the shared restaurant');
});

test('a delayed profile response does not overwrite a newer untouched field', async () => {
  const {app, changes} = await editor();
  app.field('Temps de préparation estimé (minutes)').props.onChange(change('35'));
  await app.flush();
  void profileForm(app).props.onSubmit(formEvent);
  const request = app.take('/api/restaurants/kaz', 'PATCH');
  app.updateProps({restaurant: {...restaurant, pickupAddress: '9 rue corrigée', acceptingOrders: false}});
  await app.flush();
  request.resolve({restaurant: {...restaurant, minutes: 35}});
  await app.flush();
  assert.equal(app.field('Adresse de retrait').props.value, '9 rue corrigée');
  assert.equal(app.field('Temps de préparation estimé (minutes)').props.value, 35);
  assert.deepEqual(Array.from(changes[0][1]), ['minutes'], 'The parent merges only fields actually saved');
});

test('menu publishing is single flight and a version conflict keeps the exact draft', async () => {
  const {app} = await editor();
  app.find(node => node.type === 'input' && node.props['aria-label'] === 'Nom de la catégorie 1').props.onChange(change('Plats du jour'));
  await app.flush();
  const submit = app.all(node => node.type === 'form')[0].props.onSubmit;
  void submit(formEvent); void submit(formEvent);
  assert.equal(app.requests.filter(item => item.options.method === 'PATCH').length, 1);
  app.take('/api/restaurants/kaz/menu', 'PATCH').reject(new ApiError(409, 'La carte a changé.'));
  await app.flush();
  assert.equal(app.find(node => node.type === 'input' && node.props['aria-label'] === 'Nom de la catégorie 1').props.value, 'Plats du jour');
  assert.equal(app.button('Publier la carte').props.disabled, true);
  const stored = JSON.parse(app.storage.get('manjeo-menu-draft-kaz'));
  assert.equal(stored.draft.version, 2);
  assert.equal(stored.draft.products[0].group, 'Plats du jour');
});

test('an armed discard cannot start a reload while publication is in progress', async () => {
  const {app} = await editor();
  app.find(node => node.type === 'input' && node.props['aria-label'] === 'Nom de la catégorie 1').props.onChange(change('Plats du jour'));
  await app.flush();
  app.button('Recharger').props.onClick();
  await app.flush();
  const discard = app.button('Abandonner et recharger').props.onClick;
  void app.all(node => node.type === 'form')[0].props.onSubmit(formEvent);
  await app.flush();
  assert.equal(app.button('Abandonner et recharger').props.disabled, true);
  discard();
  assert.equal(app.requests.filter(item => item.path.endsWith('/menu') && !item.options.method).length, 1);
});

function controlledFiles() {
  const readers = [];
  class FileReader {
    constructor() {readers.push(this);}
    readAsDataURL() {}
    finish() {this.result = 'data:image/png;base64,aGVsbG8='; this.onload();}
  }
  return {FileReader, readers};
}
async function photoInput(app) {
  app.button('Modifier').props.onClick();
  await app.flush();
  return app.find(node => node.type === 'input' && node.props.type === 'file');
}

test('double photo selection creates one upload and preserves the unsaved menu', async () => {
  const {FileReader, readers} = controlledFiles();
  const {app} = await editor({globals: {FileReader}});
  const input = await photoInput(app);
  const event = () => ({target: {files: [{type: 'image/png', size: 100}], value: 'photo.png'}});
  input.props.onChange(event()); input.props.onChange(event());
  assert.equal(readers.length, 1);
  readers[0].finish();
  await app.flush();
  app.take('/api/restaurants/kaz/images', 'POST').resolve({url: '/api/images/test-photo'});
  await app.flush();
  assert.equal(app.requests.filter(item => item.path.endsWith('/images')).length, 1);
  assert.equal(app.field('Photo : adresse HTTPS').props.value, '/api/images/test-photo');
  assert.equal(JSON.parse(app.storage.get('manjeo-menu-draft-kaz')).draft.products[0].image, '/api/images/test-photo');
  assert.equal(app.requests.filter(item => item.path.endsWith('/menu') && item.options.method === 'PATCH').length, 0, 'Photo upload does not silently publish the draft');
});

test('leaving the editor during local photo reading does not upload under a later session', async () => {
  const {FileReader, readers} = controlledFiles();
  const {app} = await editor({globals: {FileReader}});
  const input = await photoInput(app);
  input.props.onChange({target: {files: [{type: 'image/png', size: 100}], value: 'photo.png'}});
  app.unmount();
  readers[0].finish();
  await app.flush();
  assert.equal(app.requests.filter(item => item.path.endsWith('/images')).length, 0);
});
