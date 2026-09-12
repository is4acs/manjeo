import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {startServer, browserTypes, api, login, saveCustomer, addMeal} from './helpers.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await server?.close(); });

for (const engine of browserTypes) {
  test(`${engine.name()}: one-click order, four roles, private destination and delivery PIN`, async () => {
    const browser = await engine.launch({headless: true});
    try {
      const customer = await browser.newContext({viewport: {width: 390, height: 844}, reducedMotion: 'reduce'});
      await login(customer, server.url);
      const owner = await saveCustomer(customer, server.url);
      const page = await customer.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const resources = []; page.on('request', request => resources.push(request.url()));
      await page.goto(server.url + '/?lang=fr');
      await page.locator('.account-header-button').waitFor();
      assert.ok(!resources.some(url => /\/staff-[^/]+\.(js|css)$/.test(url)), 'The client should not download professional modules');
      await addMeal(page);
      const cart = page.locator('[role="dialog"]').filter({has: page.locator('.cart-panel')});
      await cart.getByText('Prêt à commander en un clic', {exact: true}).waitFor();
      let creates = 0; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/orders') creates++; });
      await cart.getByRole('button', {name: /^Confirmer ·/}).click();
      await page.locator('.order-ticket').waitFor();
      const id = await page.locator('.order-ticket > div').first().locator('strong').innerText();
      const order = (await api(customer, server.url, '/api/orders')).orders.find(value => value.id === id);
      assert.equal(creates, 1); assert.equal(order.status, 'pending');
      assert.deepEqual(order.deliveryLocation.latitude, owner.deliveryAddress.latitude);
      assert.equal(order.details, 'Portail bleu');
      await page.reload(); await page.locator('.active-order-card').filter({hasText: 'Ti Kaz Kréol'}).waitFor();

      const restaurant = await browser.newContext(); const courier = await browser.newContext(); const admin = await browser.newContext();
      await login(restaurant, server.url, 'restaurant'); await login(courier, server.url, 'courier'); await login(admin, server.url, 'admin');
      const kitchenOrder = (await api(restaurant, server.url, '/api/orders')).orders.find(value => value.id === id);
      assert.equal(kitchenOrder.deliveryLocation, undefined); assert.equal(kitchenOrder.deliveryCode, undefined);
      assert.ok((await api(admin, server.url, '/api/users')).users.every(user => !user.deliveryAddress));
      const restaurantPage = await restaurant.newPage(); restaurantPage.on('pageerror', error => errors.push(error.message));
      await restaurantPage.goto(server.url + '/?lang=fr');
      const kitchenCard = restaurantPage.locator('.staff-order').filter({hasText: id});
      await kitchenCard.getByRole('button', {name: 'Accepter la commande', exact: true}).click();
      await kitchenCard.getByRole('button', {name: 'Commencer la préparation', exact: true}).waitFor();
      const courierPage = await courier.newPage(); courierPage.on('pageerror', error => errors.push(error.message));
      await courierPage.goto(server.url + '/?lang=fr');
      const online = courierPage.getByRole('switch', {name: 'Être disponible pour les courses'});
      await online.waitFor();
      if (await online.getAttribute('aria-checked') !== 'true') await online.click();
      const availableCard = courierPage.locator('.courier-offer').filter({hasText: id});
      await availableCard.waitFor();
      const offer = (await api(courier, server.url, '/api/deliveries')).available.find(value => value.id === id);
      assert.ok(offer); assert.equal(offer.address, undefined); assert.equal(offer.phone, undefined); assert.equal(offer.deliveryLocation, undefined);
      await availableCard.getByRole('button', {name: 'Prendre cette course', exact: true}).click();
      await courierPage.locator('.courier-route').waitFor();
      const links = await courierPage.locator('.courier-stop').nth(1).locator('a[target="_blank"]').evaluateAll(elements => elements.map(element => element.href));
      assert.equal(links.length, 3); assert.ok(links.some(url => url.includes('waze.com/ul?ll=')));
      assert.ok(links.some(url => url.includes('maps.apple.com/?daddr='))); assert.ok(links.some(url => url.includes('google.com/maps/dir/?api=1')));
      await kitchenCard.getByRole('button', {name: 'Commencer la préparation', exact: true}).click();
      await kitchenCard.getByRole('button', {name: 'Marquer prête', exact: true}).click();
      await kitchenCard.locator('.staff-status-ready').waitFor();
      await courierPage.getByRole('button', {name: 'Actualiser les courses', exact: true}).click();
      await courierPage.getByRole('button', {name: 'J’ai récupéré la commande', exact: true}).click();
      const pin = courierPage.getByRole('textbox', {name: 'Code de remise du client'});
      await pin.fill(order.deliveryCode === '0000' ? '0001' : '0000');
      await courierPage.getByRole('button', {name: 'Confirmer la livraison', exact: true}).click();
      await courierPage.getByRole('alert').filter({hasText: 'Le code de remise est incorrect.'}).waitFor();
      await pin.fill(order.deliveryCode);
      await courierPage.getByRole('button', {name: 'Confirmer la livraison', exact: true}).click();
      await courierPage.getByText('Livraison confirmée. La mission est terminée.', {exact: true}).waitFor();
      assert.equal((await api(customer, server.url, '/api/orders')).orders.find(value => value.id === id).status, 'delivered');
      assert.equal((await api(admin, server.url, '/api/orders')).orders.find(value => value.id === id).status, 'delivered');
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });

  test(`${engine.name()}: three persistent languages, keyboard selector and small-screen dialogs`, async () => {
    const browser = await engine.launch({headless: true});
    try {
      const context = await browser.newContext({viewport: {width: 320, height: 568}, reducedMotion: 'reduce'});
      const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(server.url); await page.locator('.account-header-button').waitFor();
      for (const [label, tag] of [['Kreyòl ayisyen', 'ht'], ['Português (Brasil)', 'pt-BR'], ['Français', 'fr']]) {
        await page.locator('.language-trigger').focus(); await page.keyboard.press('Enter');
        const button = await page.locator('.language-trigger').boundingBox(); const menu = await page.locator('.language-menu').boundingBox();
        assert.ok(menu.y >= button.y + button.height - 1);
        await page.getByRole('menuitemradio', {name: label, exact: true}).click();
        await page.reload(); await page.locator('.account-header-button').waitFor();
        assert.equal(await page.locator('html').getAttribute('lang'), tag);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      for (const label of ['Obtenir de l’aide', 'Informations sur l’entreprise', 'Installer l’application']) {
        await page.getByRole('button', {name: new RegExp(label)}).click();
        const dialog = page.getByRole('dialog'); await dialog.waitFor();
        const bounds = await dialog.boundingBox(); assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 568);
        assert.equal(await dialog.evaluate(element => getComputedStyle(element).overflowY), 'auto');
        for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
          await page.keyboard.press(key);
          assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)), 'Dialog focus must stay inside until it is closed');
        }
        await page.keyboard.press('Escape'); await dialog.waitFor({state: 'hidden'});
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
