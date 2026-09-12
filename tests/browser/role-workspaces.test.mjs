import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, browserTypes, login, api, addMeal} from './helpers.mjs';

const spaces = [
  {role: 'restaurant', path: '/restaurant', label: 'Espace restaurateur'},
  {role: 'courier', path: '/livreur', label: 'Espace livreur'},
  {role: 'admin', path: '/admin', label: 'Administration'},
];
const clientControls = '.header-cart, .location-button, .restaurant-row, .product-card, .cart-sheet, .checkout-form, .customer-profile-form, .hero, .site-footer';
const isClientEndpoint = path => ['/api/restaurants', '/api/promotions', '/api/promotions/check', '/api/payments/config'].includes(path) || path.startsWith('/api/addresses/');

async function isolated(engine, run) {
  const server = await startServer(); let browser;
  try {
    browser = await engine.launch({headless: true});
    await run(browser, server.url);
  } finally { try { await browser?.close(); } finally { await server.close(); } }
}

async function signIn(page, role) {
  const email = `${role === 'courier' ? 'livreur' : role}@manjeo.test`;
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill('ManjeoDemo2026!');
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/login' && value.request().method() === 'POST');
  await page.getByRole('button', {name: 'Se connecter', exact: true}).click();
  assert.equal((await response).status(), 200);
}

async function noClientUI(page) {
  assert.equal(await page.locator(clientControls).count(), 0, 'Professional sessions must not mount customer shopping, address or checkout controls');
  assert.equal(await page.getByRole('button', {name: /Voir la vitrine|Retour aux restaurants|Manjéo, voir la vitrine/}).count(), 0);
}

async function workspace(page, space) {
  await page.waitForURL(url => url.pathname === space.path);
  await page.locator('.staff-app').waitFor();
  await page.locator('.staff-loading').waitFor({state: 'hidden'});
  assert.equal(await page.locator('.staff-space-label').innerText(), space.label);
  assert.equal(await page.locator('.staff-alert[role="alert"]').count(), 0);
  await noClientUI(page);
}

async function gate(page, path) {
  await page.waitForURL(url => url.pathname === path);
  await page.locator('input[name="email"]').waitFor();
  assert.equal(await page.locator('.professional-login').count(), 1);
  assert.equal(await page.locator('.demo-account-picker').count(), 0, 'Professional sign-in contains no customer or other-role entry buttons');
  assert.equal(await page.locator('.staff-app').count(), 0);
  await noClientUI(page);
}

function recordRequests(page) {
  const requests = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) requests.push({path, method: request.method(), data: request.postDataJSON()});
  });
  return requests;
}

function noClientRequests(requests) {
  assert.deepEqual(requests.filter(request => isClientEndpoint(request.path)), [], 'A professional workspace must not depend on customer catalogue, promotions, geocoding or payment configuration');
  assert.deepEqual(requests.filter(request => request.path === '/api/orders' && request.method === 'POST'), [], 'No customer order may be created when entering a professional workspace');
  assert.deepEqual(requests.filter(request => request.path === '/api/profile' && ['deliveryAddress', 'paymentMethod'].some(key => Object.hasOwn(request.data || {}, key))), []);
}

for (const engine of browserTypes) {
  test(`${engine.name()}: an unknown session never loads customer data and retry restores the professional workspace`, () => isolated(engine, async (browser, url) => {
    for (const space of spaces) {
      const context = await browser.newContext({reducedMotion: 'reduce'});
      await login(context, url, space.role);
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const requests = recordRequests(page);
      await page.route(url + '/api/session', route => route.fulfill({status: 503, json: {error: 'Session momentanément indisponible.'}}));
      await page.goto(url + '/?lang=fr');
      await page.getByRole('heading', {name: 'Votre espace est momentanément indisponible.', exact: true}).waitFor();
      await page.getByText('Session momentanément indisponible.', {exact: true}).waitFor();
      await noClientUI(page);
      noClientRequests(requests);
      await page.unroute(url + '/api/session');
      await page.getByRole('button', {name: 'Réessayer', exact: true}).click();
      await workspace(page, space);
      noClientRequests(requests);
      await context.close();
    }
  }));

  test(`${engine.name()}: professional login, deep links, reload, browser history and logout stay in the account workspace`, () => isolated(engine, async (browser, url) => {
    for (const space of spaces) {
      const context = await browser.newContext({viewport: {width: 390, height: 844}, reducedMotion: 'reduce'});
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const requests = recordRequests(page);
      // An outage in any customer-only dependency must not prevent login or work.
      await page.route('**/api/**', route => isClientEndpoint(new URL(route.request().url()).pathname)
        ? route.fulfill({status: 503, json: {error: 'Panne simulée du parcours client.'}}) : route.continue());
      await page.goto(url + space.path + '?lang=fr');
      await gate(page, space.path);
      await signIn(page, space.role);
      await workspace(page, space);
      await page.getByRole('button', {name: 'Mon compte', exact: true}).click();
      await page.locator('.profile-form').waitFor();
      await noClientUI(page);
      await page.keyboard.press('Escape');
      await page.locator('.account-dialog').waitFor({state: 'hidden'});

      for (const path of ['/', ...spaces.filter(value => value.role !== space.role).map(value => value.path), '/restaurants/ti-kreol']) {
        await page.goto(url + path + '?lang=fr');
        await workspace(page, space);
      }
      await page.reload(); await workspace(page, space);
      await page.goBack(); await workspace(page, space);
      await page.goForward(); await workspace(page, space);
      await page.getByRole('button', {name: 'Déconnexion', exact: true}).click();
      await gate(page, space.path);
      await page.reload(); await gate(page, space.path);
      noClientRequests(requests);
      const dataPath = space.role === 'courier' ? '/api/deliveries' : '/api/workspace/restaurants';
      assert.ok(requests.some(request => request.path === dataPath), `${space.role} must load its actual workspace data`);
      // The same login entry accepts a client, who must land in the client space.
      await page.unroute('**/api/**');
      await signIn(page, 'client');
      await page.waitForURL(value => value.pathname === '/');
      await page.locator('.restaurant-row').first().waitFor();
      assert.equal(await page.locator('.staff-app').count(), 0);
      await page.goto(url + space.path);
      await page.waitForURL(value => value.pathname === '/');
      await page.locator('.restaurant-row').first().waitFor();
      assert.equal(await page.locator('.staff-app, .professional-login').count(), 0, 'A client visiting a professional deep link stays in the client workspace');
      assert.deepEqual(errors, []);
      await context.close();
    }
  }));

  test(`${engine.name()}: an old guest checkout intention cannot reopen shopping after professional login`, () => isolated(engine, async (browser, url) => {
    for (const space of spaces) {
      const context = await browser.newContext({viewport: {width: 390, height: 844}, reducedMotion: 'reduce'});
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(url + '/?lang=fr');
      await addMeal(page);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('manjeo-cart-v2') || '[]').length === 1);
      const basket = await page.evaluate(() => localStorage.getItem('manjeo-cart-v2'));
      await page.locator('.cart-checkout').click();
      await page.locator('.account-dialog').waitFor();
      const requests = recordRequests(page);
      await signIn(page, space.role);
      await workspace(page, space);
      await page.goto(url + '/?lang=fr'); await workspace(page, space);
      await page.reload(); await workspace(page, space);
      assert.equal(await page.evaluate(() => localStorage.getItem('manjeo-cart-v2')), basket, 'A professional session does not rewrite the saved client basket');
      noClientRequests(requests);
      await page.getByRole('button', {name: 'Déconnexion', exact: true}).click();
      await gate(page, space.path);
      noClientRequests(requests);
      await signIn(page, 'client');
      await page.waitForURL(value => value.pathname === '/');
      await page.locator('.restaurant-row').first().waitFor();
      assert.equal(await page.locator('.checkout-form, .cart-sheet').count(), 0, 'Changing roles never resumes checkout automatically');
      await page.locator('.header-cart').click();
      await page.locator('.cart-lines').waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem('manjeo-cart-v2')), basket);
      assert.equal(requests.filter(request => request.path === '/api/orders' && request.method === 'POST').length, 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
  }));

  test(`${engine.name()}: another-tab professional login bypasses a pending client catalogue and ignores its late response`, () => isolated(engine, async (browser, url) => {
    // Save a genuine guest response before changing the cookie. Only its timing
    // changes: the old response contains the actual customer catalogue.
    const context = await browser.newContext({reducedMotion: 'reduce'});
    const catalogue = await api(context, url, '/api/restaurants');
    for (const [index, space] of spaces.entries()) {
      await api(context, url, '/api/logout', 'POST', {});
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      let pending;
      const captured = new Promise(resolve => { pending = resolve; });
      await page.route(url + '/api/restaurants', route => pending(route));
      const requestStarted = page.waitForRequest(request => new URL(request.url()).pathname === '/api/restaurants');
      await page.goto(url + '/?lang=fr');
      await requestStarted;
      const oldRequest = await captured;
      await login(context, url, space.role);
      const requests = recordRequests(page);
      // A storage event is how another same-origin tab announces a new cookie.
      await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', {key: 'manjeo-session-change'})));
      await workspace(page, space);
      if (index === 1) await oldRequest.fulfill({status: 503, json: {error: 'Ancien catalogue indisponible.'}});
      else await oldRequest.fulfill({json: catalogue});
      await page.getByRole('button', {name: 'Mon compte', exact: true}).click();
      await page.locator('.profile-form').waitFor();
      await noClientUI(page);
      assert.equal(await page.getByText('Ancien catalogue indisponible.', {exact: true}).count(), 0);
      assert.equal(new URL(page.url()).pathname, space.path);
      noClientRequests(requests);
      await page.keyboard.press('Escape');
      await page.locator('.account-dialog').waitFor({state: 'hidden'});
      const otherSpace = spaces[(index + 1) % spaces.length];
      await login(context, url, otherSpace.role);
      await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', {key: 'manjeo-session-change'})));
      await workspace(page, otherSpace);
      await api(context, url, '/api/logout', 'POST', {});
      await page.evaluate(() => window.dispatchEvent(new Event('manjeo-session-expired')));
      await gate(page, otherSpace.path);
      noClientRequests(requests);
      assert.deepEqual(errors, []);
      await page.close();
    }
    await context.close();
  }));
}
