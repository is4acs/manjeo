import test, {beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {startServer, browserTypes, api, login, saveCustomer, addMeal} from './helpers.mjs';

let server;
beforeEach(async () => {server = await startServer();});
afterEach(async () => {await server?.close();});

for (const engine of browserTypes) {
  test(`${engine.name()}: chat preserves originals, translates prepared replies and revokes a released courier`, async () => {
    const browser = await engine.launch({headless:true});
    try {
      const client = await browser.newContext({reducedMotion:'reduce'});
      const courier = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
      const restaurant = await browser.newContext();
      const admin = await browser.newContext();
      await login(client, server.url); await saveCustomer(client, server.url);
      await login(restaurant, server.url, 'restaurant'); await login(admin, server.url, 'admin');
      const driver = (await login(courier, server.url, 'courier')).user;
      await api(courier, server.url, '/api/profile', 'PATCH', {language:'ht'});
      await api(courier, server.url, '/api/courier/profile', 'PATCH', {online:true});
      const customerPage = await client.newPage();
      await customerPage.goto(server.url + '/?lang=fr'); await customerPage.locator('.account-header-button').waitFor();
      await addMeal(customerPage); await customerPage.locator('.cart-sheet').getByRole('button',{name:/^Confirmer ·/}).click();
      await customerPage.locator('.order-ticket').waitFor();
      const id = await customerPage.locator('.order-ticket > div').first().locator('strong').innerText();
      await api(restaurant, server.url, `/api/orders/${id}`, 'PATCH', {status:'accepted'});
      await api(courier, server.url, `/api/orders/${id}/claim`, 'POST', {});
      await customerPage.reload();
      await customerPage.locator('.active-order-card').filter({hasText:'Ti Kaz Kréol'}).getByRole('button',{name:'Suivre la livraison',exact:true}).click();
      const chat = customerPage.locator('.order-chat');
      await chat.getByRole('button',{name:'Je suis en bas, devant l’entrée.',exact:true}).click();
      await chat.locator('.chat-message').filter({hasText:'Je suis en bas, devant l’entrée.'}).waitFor();
      const original = 'Le portail du jardin est bleu ; merci de ne pas sonner.';
      await chat.getByRole('textbox',{name:'Votre message',exact:true}).fill(original);
      await chat.getByRole('button',{name:'Envoyer',exact:true}).click();
      await chat.locator('.chat-message').filter({hasText:original}).waitFor();

      const courierPage = await courier.newPage();
      const errors = []; courierPage.on('pageerror', error=>errors.push(error.message));
      const threadRequests = []; const translations = [];
      courierPage.on('request', request=>{
        if (new URL(request.url()).pathname === `/api/orders/${id}/thread`) threadRequests.push(request.headers()['x-manjeo-account']);
        if (new URL(request.url()).pathname === '/api/translate') translations.push(request.postDataJSON());
      });
      await courierPage.goto(server.url + '/?lang=ht');
      const driverChat = courierPage.locator('.order-chat');
      const prepared = driverChat.locator('.chat-message').filter({hasText:'Mwen anba a, devan pòt la.'});
      await prepared.waitFor();
      await prepared.locator('.chat-origin button').click();
      await driverChat.getByText('Je suis en bas, devant l’entrée.',{exact:true}).waitFor();
      const freeMessage = driverChat.locator('.chat-message').filter({hasText:original});
      await freeMessage.waitFor();
      await freeMessage.locator('.chat-origin button').waitFor();
      assert.equal(await freeMessage.locator('p').getAttribute('lang'),'fr');
      assert.equal(await freeMessage.locator('p').innerText(),original);
      assert.ok(threadRequests.length && threadRequests.every(value=>value === driver.id));
      const thread = await api(courier, server.url, `/api/orders/${id}/thread`);
      const phraseId = thread.messages.find(message=>message.phraseId === 'downstairs').id;
      assert.ok(!translations.some(request=>request.messageId === phraseId), 'Prepared replies require no external translation service');
      assert.ok(translations.some(request=>request.messageId === thread.messages.find(message=>message.body === original).id));
      assert.ok(await driverChat.locator('a[href^="tel:"]').count());

      // A second device releases the mission. The old page loses the destination,
      // telephone numbers and messages on its next visible refresh.
      await api(courier, server.url, `/api/orders/${id}/release`, 'POST', {reason:'Panne du vélo de test'});
      const denied = await courier.request.get(server.url + `/api/orders/${id}/thread`);
      assert.equal(denied.status(),403);
      await courierPage.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      await courierPage.locator('.courier-route').waitFor({state:'detached'});
      assert.equal(await courierPage.locator('.order-chat').count(),0);
      assert.equal(await courierPage.locator('a[href="tel:0694010203"]').count(),0);
      const retained = await api(client, server.url, `/api/orders/${id}/thread`);
      assert.ok(retained.messages.some(message=>message.body === original));
      await api(admin, server.url, `/api/orders/${id}`, 'PATCH', {status:'cancelled',reason:'Fin du scénario isolé'});
      assert.deepEqual(errors,[]);
    } finally {await browser.close();}
  });
}
