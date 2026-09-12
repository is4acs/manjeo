import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {startServer, browserTypes, api, login, saveCustomer, addMeal} from './helpers.mjs';

let server;
before(async () => {server = await startServer();});
after(async () => {await server?.close();});

for (const engine of browserTypes) {
  test(`${engine.name()}: a lost order response survives reload and preserves the recipient, instructions and UUID`, async () => {
    const browser = await engine.launch({headless:true});
    try {
      const context = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
      await login(context, server.url);
      await saveCustomer(context, server.url);
      const initialOrders = (await api(context, server.url, '/api/orders')).orders.length;
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error=>errors.push(error.message));
      const attempts = [];
      let confirmed;
      await page.route(server.url + '/api/orders', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        attempts.push(route.request().postDataJSON());
        if (attempts.length !== 1) return route.continue();
        // The real isolated server creates the order; only its response is lost.
        const result = await route.fetch();
        assert.equal(result.status(), 201);
        confirmed = (await result.json()).order;
        await route.abort('failed');
      });
      await page.goto(server.url + '/?lang=fr');
      await page.locator('.account-header-button').waitFor();
      await addMeal(page);
      await page.getByRole('button',{name:'Modifier les coordonnées ou le paiement',exact:true}).click();
      await page.locator('.checkout-form input[name="name"]').fill('Destinataire du cadeau');
      await page.locator('.checkout-form input[name="details"]').fill('Remettre au portail du jardin');
      await page.locator('.checkout-form textarea[name="notes"]').fill('Ne pas sonner pendant la sieste');
      await page.locator('.save-checkout-profile input').uncheck();
      await page.locator('.submit-order').click();
      await page.locator('.pending-order').first().waitFor();
      assert.equal(attempts.length, 1);
      assert.equal((await api(context, server.url, '/api/orders')).orders.length, initialOrders + 1);

      // The stored defaults can change elsewhere before this browser recovers.
      await api(context, server.url, '/api/profile', 'PATCH', {name:'Profil actualisé ailleurs',phone:'0694998877'});
      await page.reload();
      await page.locator('.pending-order').first().getByText('Destinataire du cadeau · 0694010203',{exact:false}).waitFor();
      await page.locator('.header-cart').click();
      const cart = page.locator('.cart-sheet');
      assert.equal(await cart.locator('.cart-checkout').isDisabled(), true);
      // A newer basket must survive acknowledgement of the original one.
      await cart.locator('.cart-lines .stepper button').last().click();
      await cart.getByRole('button',{name:'Reprendre cette confirmation',exact:true}).click();
      await page.locator('.order-ticket').waitFor();
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts[1], attempts[0]);
      assert.equal(await page.locator('.order-ticket > div').first().locator('strong').innerText(), confirmed.id);
      const stored = (await api(context, server.url, '/api/orders')).orders;
      assert.equal(stored.length, initialOrders + 1);
      const order = stored.find(item=>item.id === confirmed.id);
      assert.equal(order.customerName, 'Destinataire du cadeau');
      assert.equal(order.details, 'Remettre au portail du jardin');
      assert.equal(order.notes, 'Ne pas sonner pendant la sieste');
      assert.equal((await api(context, server.url, '/api/session')).user.name, 'Profil actualisé ailleurs');
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('manjeo-cart-v2') || '[]')[0]?.quantity === 2);
      assert.deepEqual(errors, []);
    } finally {await browser.close();}
  });

  test(`${engine.name()}: a phone draft survives another-device refresh without overwriting its newer name`, async () => {
    const browser = await engine.launch({headless:true});
    try {
      const context = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
      await login(context, server.url);
      await saveCustomer(context, server.url);
      const page = await context.newPage();
      const changes = [];
      page.on('request', request => {
        if (request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/profile') changes.push(request.postDataJSON());
      });
      await page.goto(server.url + '/?lang=fr');
      await page.locator('.account-header-button').click();
      const account = page.locator('.customer-profile-form');
      await account.getByLabel('Téléphone',{exact:true}).fill('0694 99 88 77');
      await api(context, server.url, '/api/profile', 'PATCH', {name:'Nom changé sur un autre appareil'});
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(()=>document.querySelector('.customer-profile-form input[autocomplete="name"]')?.value === 'Nom changé sur un autre appareil');
      assert.equal(await account.getByLabel('Téléphone',{exact:true}).inputValue(),'0694 99 88 77');
      await account.getByRole('button',{name:'Enregistrer mes coordonnées',exact:true}).click();
      await account.getByText('Vos coordonnées sont enregistrées.',{exact:true}).waitFor();
      assert.deepEqual(changes.at(-1), {phone:'0694 99 88 77'});
      const updated = (await api(context, server.url, '/api/session')).user;
      assert.equal(updated.name, 'Nom changé sur un autre appareil');
      assert.equal(updated.phone.replace(/\s/g,''), '0694998877');
    } finally {await browser.close();}
  });
}
