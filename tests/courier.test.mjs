import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError, change, formEvent, staffHarness} from './support/staff-harness.mjs';

const profile = {id: 'driver', name: 'Livreur test', online: true, activeOrderId: null};
const offer = {id: 'ORDER-1', restaurant: 'La Kaz', pickupAddress: '7 rue du restaurant', pickupCity: 'Cayenne', city: 'Cayenne', count: 1, delivery: 250, status: 'ready'};
const mission = {...offer, courierId: 'driver', customerName: 'Client privé', address: '12 rue privée', phone: '0694 00 00 00', items: [], history: [{status: 'accepted'}], updatedAt: '2026-09-12T18:00:00Z'};
const empty = {available: [offer], assigned: [], profile, unread: {}};
const assigned = (order = mission) => ({available: [], assigned: [order], profile: {...profile, activeOrderId: order.id}, unread: {[order.id]: 1}});
const props = {user: {id: 'driver', role: 'courier', name: 'Livreur test', language: 'fr'}, onLogout() {}, onShop() {}, onAccount() {}};

async function courier(data = empty) {
  const app = staffHarness('courier.tsx', props);
  app.take('/api/deliveries').resolve(data);
  await app.flush();
  return app;
}
const codeInput = app => app.find(node => node.props?.['aria-label'] === 'Code de remise du client');
const deliveryForm = app => app.find(node => node.props?.className === 'staff-action-form courier-code-form');

test('one claim at a time and an older offer poll cannot replace the claimed mission', async () => {
  const app = await courier();
  app.tick();
  const old = app.take('/api/deliveries');
  const click = app.button('Prendre cette course').props.onClick;
  click(); click();
  assert.equal(app.requests.filter(item => item.options.method === 'POST').length, 1);
  app.take('/api/orders/ORDER-1/claim', 'POST').resolve({order: mission});
  await app.flush();
  old.resolve(empty);
  await app.flush();
  assert.ok(app.text.includes('12 rue privée'));
  assert.equal(app.button('Prendre cette course'), undefined);
  app.take('/api/deliveries').resolve(assigned());
  await app.flush();
  assert.equal(app.button('J’ai récupéré la commande').props.disabled, false);
});

test('releasing a mission removes private details immediately even if the refresh fails', async () => {
  const app = await courier(assigned());
  app.button('Je ne peux pas effectuer cette course').props.onClick();
  await app.flush();
  app.field('Motif de libération').props.onChange(change('Panne du véhicule'));
  await app.flush();
  void app.find(node => node.props?.className === 'staff-action-form courier-release-form').props.onSubmit(formEvent);
  app.take('/api/orders/ORDER-1/release', 'POST').resolve({ok: true});
  await app.flush();
  assert.ok(!app.text.includes('12 rue privée'));
  assert.equal(app.find(node => node.type === 'a' && node.props.href?.startsWith('tel:')), undefined);
  app.take('/api/deliveries').reject(new Error('Réseau indisponible'));
  await app.flush();
  assert.ok(!app.text.includes('12 rue privée'));
  assert.ok(app.text.includes('La course est à nouveau disponible pour un autre livreur.'));
});

test('assignment revoked by a refresh removes the former client and contact controls', async () => {
  const app = await courier(assigned());
  app.tick();
  app.take('/api/deliveries').resolve({...empty, available: []});
  await app.flush();
  assert.ok(!app.text.includes('Client privé'));
  assert.equal(app.find(node => node.props?.order?.id === mission.id), undefined);
});

test('incorrect PIN keeps the entered leading zero and blocks duplicate requests until reconciliation', async () => {
  const order = {...mission, status: 'picked_up'};
  const app = await courier(assigned(order));
  codeInput(app).props.onChange(change('0123'));
  await app.flush();
  const submit = deliveryForm(app).props.onSubmit;
  void submit(formEvent); void submit(formEvent);
  const request = app.take('/api/orders/ORDER-1', 'PATCH');
  assert.deepEqual(JSON.parse(request.options.body), {status: 'delivered', deliveryCode: '0123'});
  assert.equal(app.requests.filter(item => item.options.method === 'PATCH').length, 1);
  request.reject(new ApiError(400, 'Le code de remise est incorrect.'));
  await app.flush();
  assert.equal(codeInput(app).props.disabled, true);
  app.take('/api/deliveries').resolve(assigned(order));
  await app.flush();
  assert.equal(codeInput(app).props.value, '0123');
  assert.equal(codeInput(app).props.disabled, false);
  assert.ok(app.text.includes('Le code de remise est incorrect.'));
});

test('a lost delivery response reconciles to delivered and cannot offer the same delivery twice', async () => {
  const app = await courier(assigned({...mission, status: 'picked_up'}));
  codeInput(app).props.onChange(change('0123'));
  await app.flush();
  void deliveryForm(app).props.onSubmit(formEvent);
  app.take('/api/orders/ORDER-1', 'PATCH').reject(new Error('Réponse interrompue'));
  await app.flush();
  app.take('/api/deliveries').resolve({available: [], assigned: [{...mission, status: 'delivered'}], profile, unread: {}});
  await app.flush();
  assert.equal(codeInput(app), undefined);
  assert.equal(deliveryForm(app), undefined);
  assert.ok(!app.text.includes('12 rue privée'));
  app.button('Historique').props.onClick();
  await app.flush();
  assert.ok(app.text.includes('ORDER-1'));
});

test('switching to a new mission clears the former delivery code', async () => {
  const app = await courier(assigned({...mission, status: 'picked_up'}));
  codeInput(app).props.onChange(change('0123'));
  await app.flush();
  app.tick();
  app.take('/api/deliveries').resolve(assigned({...mission, id: 'ORDER-2', status: 'picked_up'}));
  await app.flush();
  assert.equal(codeInput(app).props.value, '');
  assert.equal(app.button('Confirmer la livraison').props.disabled, true);
});

test('a claim completing after logout does not read or mutate the next session', async () => {
  const app = await courier();
  app.button('Prendre cette course').props.onClick();
  const request = app.take('/api/orders/ORDER-1/claim', 'POST');
  app.unmount();
  request.resolve({order: mission});
  await app.flush();
  assert.equal(app.requests.filter(item => item.path === '/api/deliveries').length, 1);
});
