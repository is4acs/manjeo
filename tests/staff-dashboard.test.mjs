import test from 'node:test';
import assert from 'node:assert/strict';
import {change, formEvent, staffHarness} from './support/staff-harness.mjs';

const restaurant = {id: 'kaz', name: 'La Kaz', description: 'Cuisine maison', minutes: 25, pickupAddress: '7 rue ancienne', pickupCity: 'Cayenne', acceptingOrders: true, products: []};
const order = {id: 'ORDER-1', restaurantId: 'kaz', restaurant: 'La Kaz', customerName: 'Client test', city: 'Cayenne', status: 'ready', date: '2026-09-12T18:00:00Z', total: 1500, subtotal: 1000, courierId: null};
const courier = {id: 'driver', name: 'Livreur test', online: true, activeOrderId: null};
const roleProps = role => ({user: {id: role, role, restaurantId: 'kaz', name: 'Compte test'}, onLogout() {}, onShop() {}, onAccount() {}});

async function settle(app, {orders = [order], restaurants = [restaurant], couriers = [courier], admin = true} = {}) {
  app.take('/api/orders').resolve({orders, unread: {}});
  app.take('/api/restaurants').resolve({restaurants});
  if (admin) {app.take('/api/users').resolve({users: []}); app.take('/api/couriers').resolve({couriers});}
  await app.flush();
}
async function dashboard(admin = true) {
  const app = staffHarness('staff.tsx', roleProps(admin ? 'admin' : 'restaurant'), {dashboard: true});
  await settle(app, {admin});
  return app;
}
const card = app => app.find(node => node.props?.onAssign);
const editor = app => app.find(node => node.props?.onRestaurantChange);

test('private dashboard reads stay scoped to the displayed account while the catalog stays public', () => {
  const app = staffHarness('staff.tsx', roleProps('admin'), {dashboard: true});
  for (const path of ['/api/orders', '/api/users', '/api/couriers']) assert.equal(app.take(path).options.accountId, 'admin');
  assert.equal(app.take('/api/restaurants').options.accountId, undefined);
});

test('a delayed open/pause response cannot revert restaurant details saved in the menu editor', async () => {
  const app = await dashboard(false);
  app.find(node => node.props?.role === 'switch').props.onClick();
  const toggle = app.take('/api/restaurants/kaz', 'PATCH');
  assert.equal(toggle.options.accountId, 'restaurant');
  assert.equal(editor(app).props.viewerId, 'restaurant');
  editor(app).props.onRestaurantChange({...restaurant, name: 'La Kaz renommée'}, ['name']);
  await app.flush();
  toggle.resolve({restaurant: {...restaurant, acceptingOrders: false}});
  await app.flush();
  assert.equal(editor(app).props.restaurant.name, 'La Kaz renommée');
  assert.equal(editor(app).props.restaurant.acceptingOrders, false);
});

test('saving only restaurant details preserves a newer open/pause state in the dashboard', async () => {
  const app = await dashboard(false);
  app.find(node => node.props?.role === 'switch').props.onClick();
  app.take('/api/restaurants/kaz', 'PATCH').resolve({restaurant: {...restaurant, acceptingOrders: false}});
  await app.flush();
  editor(app).props.onRestaurantChange({...restaurant, minutes: 35}, ['minutes']);
  await app.flush();
  assert.equal(editor(app).props.restaurant.minutes, 35);
  assert.equal(editor(app).props.restaurant.acceptingOrders, false);
});

test('after an uncertain command response the dashboard immediately reconciles its status', async () => {
  const app = await dashboard();
  card(app).props.onStatus(order, 'cancelled', 'Annulation test');
  const update = app.take('/api/orders/ORDER-1', 'PATCH');
  assert.equal(update.options.accountId, 'admin');
  update.reject(new Error('Réponse interrompue'));
  await app.flush();
  await settle(app, {orders: [{...order, status: 'cancelled'}]});
  app.find(node => node.type === 'select' && node.props.value === 'active').props.onChange({target: {value: 'all'}});
  await app.flush();
  assert.equal(card(app).props.order.status, 'cancelled');
  assert.ok(app.text.includes('Réponse interrompue'), 'Reconciliation must not hide the failed response');
});

test('successful assignment remains successful when the subsequent courier refresh fails', async () => {
  const app = await dashboard();
  card(app).props.onAssign(order, 'driver', 'Affectation test');
  const assignment = app.take('/api/orders/ORDER-1/assign', 'POST');
  assert.equal(assignment.options.accountId, 'admin');
  assignment.resolve({order: {...order, courierId: 'driver', courierName: 'Livreur test'}});
  await app.flush();
  app.take('/api/couriers').reject(new Error('Liste des livreurs indisponible'));
  await app.flush();
  assert.equal(card(app).props.order.courierId, 'driver');
  assert.ok(app.text.includes('L’affectation du livreur est enregistrée.'), 'A successful mutation is distinct from a failed refresh');
});

test('a poll started before a mutation cannot roll its confirmed result back', async () => {
  const app = await dashboard();
  app.tick();
  const stale = app.take('/api/orders');
  const staleRestaurants = app.take('/api/restaurants');
  const staleUsers = app.take('/api/users');
  const staleCouriers = app.take('/api/couriers');
  card(app).props.onStatus(order, 'preparing');
  app.take('/api/orders/ORDER-1', 'PATCH').resolve({order: {...order, status: 'preparing'}});
  await app.flush();
  stale.resolve({orders: [order], unread: {}}); staleRestaurants.resolve({restaurants: [restaurant]}); staleUsers.resolve({users: []}); staleCouriers.resolve({couriers: [courier]});
  await app.flush();
  assert.equal(card(app).props.order.status, 'preparing');
});

test('a refund request carries the displayed admin identity outside the payment body', async () => {
  const app = await dashboard();
  card(app).props.onRefund(order);
  const refund = app.take('/api/orders/ORDER-1/refund', 'POST');
  assert.equal(refund.options.accountId, 'admin');
  assert.deepEqual(JSON.parse(refund.options.body), {});
});

test('a selected courier becoming paused, occupied or absent disables and guards assignment', async () => {
  const assignments = [];
  const app = staffHarness('staff.tsx', {
    order: {...order, items: [], history: []}, admin: true, busy: false, onStatus() {}, onRefund() {},
    couriers: [courier], onAssign: (...args) => assignments.push(args), language: 'fr', unread: 0, viewerId: 'admin',
  }, {componentName: 'OrderCard'});
  await app.flush();
  app.field('Livreur').props.onChange(change('driver'));
  app.field('Motif de l’affectation').props.onChange(change('Affectation de test'));
  await app.flush();
  assert.equal(app.button('Confirmer l’affectation').props.disabled, false);
  for (const couriers of [[{...courier, online: false}], [{...courier, activeOrderId: 'ANOTHER-ORDER'}], []]) {
    app.updateProps({couriers});
    await app.flush();
    assert.equal(app.button('Confirmer l’affectation').props.disabled, true);
    app.find(node => node.type === 'form').props.onSubmit(formEvent);
    assert.equal(assignments.length, 0);
  }
  app.updateProps({couriers: [courier]});
  await app.flush();
  app.find(node => node.type === 'form').props.onSubmit(formEvent);
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0][1], 'driver');
});
