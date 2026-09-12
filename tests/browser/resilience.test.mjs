import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {startServer, browserTypes, login, api} from './helpers.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await server?.close(); });

for (const engine of browserTypes) {
  test(`${engine.name()}: failed professional module retries network and HTTP failures inside the same workspace`, async () => {
    const browser = await engine.launch({headless: true});
    try {
      for (const mode of ['network', 'http503']) {
        const context = await browser.newContext({reducedMotion: 'reduce'});
        const user = (await login(context, server.url, 'restaurant')).user;
        const page = await context.newPage();
        const requests = [];
        page.on('request', request => requests.push({path: new URL(request.url()).pathname, method: request.method()}));
        await page.route('**/assets/staff-*.js*', route => mode === 'network' ? route.abort('failed')
          : route.fulfill({status: 503, headers: {'cache-control': 'no-store'}, contentType: 'text/plain', body: 'Temporarily unavailable'}));
        await page.goto(server.url + '/?lang=fr');
        await page.getByRole('heading', {name: 'Votre espace est momentanément indisponible.'}).waitFor();
        assert.equal(await page.getByRole('button', {name: 'Recharger la page', exact: true}).count(), 1);
        assert.equal(await page.locator('.language-trigger').count(), 1);
        assert.equal(new URL(page.url()).pathname, '/restaurant');
        assert.equal(await page.getByRole('button', {name: 'Retour aux restaurants', exact: true}).count(), 0);
        assert.equal(await page.locator('.header-cart, .restaurant-row, .site-footer').count(), 0);
        const workspaceUrl = page.url();
        await page.unroute('**/assets/staff-*.js*');
        await page.getByRole('button', {name: 'Réessayer', exact: true}).click();
        await page.locator('.staff-app').waitFor();
        await page.locator('.staff-loading').waitFor({state: 'hidden'});
        assert.equal(page.url(), workspaceUrl, `${mode}: recovery keeps the same professional URL`);
        assert.equal(await page.locator('.header-cart, .restaurant-row, .site-footer').count(), 0);
        assert.deepEqual(requests.filter(request => request.path === '/api/restaurants' || request.path === '/api/login'), [], `${mode}: recovery neither opens the client catalogue nor reconnects the user`);
        assert.equal((await api(context, server.url, '/api/session')).user.id, user.id);
        await context.close();
      }
    } finally { await browser.close(); }
  });

  test(`${engine.name()}: a stalled workspace manifest or import returns to recovery after fifteen seconds`, async () => {
    const browser = await engine.launch({headless: true});
    try {
      for (const stalled of ['manifest', 'import']) {
        const context = await browser.newContext({reducedMotion: 'reduce'});
        await login(context, server.url, 'restaurant');
        const page = await context.newPage(); page.setDefaultTimeout(10000);
        await page.clock.install();
        const requests = [];
        page.on('request', request => requests.push(new URL(request.url()).pathname));
        await page.route('**/assets/staff-*.js*', route => route.abort('failed'));
        await page.goto(server.url + '/restaurant?lang=fr');
        const unavailable = page.getByRole('heading', {name: 'Votre espace est momentanément indisponible.', exact: true});
        await unavailable.waitFor();
        await page.unroute('**/assets/staff-*.js*');
        const pattern = stalled === 'manifest' ? '**/asset-manifest.json' : '**/assets/staff-*.js*';
        // Keep the real browser request pending: no artificial error response or
        // retry is delivered. Only the application's own timeout may recover.
        await page.route(pattern, () => {});
        const started = page.waitForRequest(request => stalled === 'manifest'
          ? new URL(request.url()).pathname === '/asset-manifest.json'
          : /\/assets\/staff-[^/]+\.js$/.test(new URL(request.url()).pathname));
        await page.getByRole('button', {name: 'Réessayer', exact: true}).click();
        await started;
        await unavailable.waitFor({state: 'hidden'});
        await page.clock.runFor(15001);
        await unavailable.waitFor();
        assert.equal(new URL(page.url()).pathname, '/restaurant');
        assert.equal(await page.getByRole('button', {name: 'Réessayer', exact: true}).isEnabled(), true);
        assert.equal(await page.getByRole('button', {name: 'Déconnexion', exact: true}).isEnabled(), true);
        assert.equal(await page.locator('.header-cart, .restaurant-row, .site-footer, .staff-app').count(), 0);
        assert.equal(requests.includes('/api/restaurants'), false);
        await context.close();
      }
    } finally { await browser.close(); }
  });

  test(`${engine.name()}: promotion loading, connection failure and explicit retry`, async () => {
    const browser = await engine.launch({headless: true});
    try {
      const page = await browser.newPage({reducedMotion: 'reduce'});
      let pending;
      let received;
      const requestReceived = new Promise(resolve => { received = resolve; });
      await page.route('**/api/promotions', route => { pending = route; received(); });
      await page.goto(server.url); await page.locator('.account-header-button').waitFor();
      await page.getByRole('button', {name: 'Promotions', exact: true}).click();
      await page.getByText('Recherche des promotions disponibles…', {exact: true}).waitFor();
      await requestReceived;
      assert.ok(pending); assert.equal(await page.getByText('Aucun code n’est ouvert en ce moment.', {exact: true}).count(), 0);
      await pending.fulfill({status: 503, json: {error: 'Le catalogue est temporairement indisponible.'}});
      await page.getByRole('alert').filter({hasText: 'Le catalogue est temporairement indisponible.'}).waitFor();
      await page.unroute('**/api/promotions');
      await page.getByRole('button', {name: 'Réessayer', exact: true}).click();
      await page.locator('.promo-catalog').waitFor();
      assert.equal(await page.getByText('Recherche des promotions disponibles…', {exact: true}).count(), 0);
    } finally { await browser.close(); }
  });

  test(`${engine.name()}: verification candidates and confirmed points expire while the account remains open`, async () => {
    const browser = await engine.launch({headless: true});
    try {
      const context = await browser.newContext({reducedMotion: 'reduce'}); await login(context, server.url);
      const page = await context.newPage();
      await page.route('**/api/addresses/verify', route => route.fulfill({json: {candidates: [{address: '7 Rue Lallouette', city: 'Cayenne',
        latitude: 4.939915, longitude: -52.332754, provider: 'ign', precision: 'house', verificationToken: 'browser-expiry-fixture',
        expiresAt: new Date(Date.now() + 1200).toISOString()}]}}));
      await page.goto(server.url + '/?lang=fr'); await page.locator('.account-header-button').click();
      await page.locator('.customer-profile-form .address-field input').fill('7 Rue Lallouette'); await page.keyboard.press('Tab');
      await page.getByRole('button', {name: 'Vérifier mon adresse', exact: true}).click();
      await page.getByRole('button', {name: 'Confirmer ce point de livraison', exact: true}).waitFor();
      const expired = page.getByText('La vérification de cette adresse a expiré. Recherchez et confirmez à nouveau votre point de livraison.', {exact: true});
      await expired.waitFor(); assert.equal(await page.getByRole('button', {name: 'Confirmer ce point de livraison', exact: true}).count(), 0);
      await page.getByRole('button', {name: 'Vérifier mon adresse', exact: true}).click();
      await page.getByRole('button', {name: 'Confirmer ce point de livraison', exact: true}).click();
      await page.getByText('Point de livraison confirmé', {exact: true}).waitFor();
      await expired.waitFor(); assert.equal(await page.getByText('Point de livraison confirmé', {exact: true}).count(), 0);
    } finally { await browser.close(); }
  });
}
