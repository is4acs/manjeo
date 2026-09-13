import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, browserTypes, login} from './helpers.mjs';

async function isolated(engine, run, viewport = {width: 1280, height: 900}) {
  const server = await startServer();
  let browser;
  try {
    browser = await engine.launch({headless: true});
    const client = await browser.newContext({viewport, reducedMotion: 'reduce'});
    await login(client, server.url);
    const page = await client.newPage();
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // L'accueil est prêt dès que la rangée d'envies est là : attendre `load` ferait dépendre
    // le test du chargement des polices distantes. La navigation garde son propre budget —
    // elle démarre un serveur neuf et analyse tout le paquet client.
    await page.goto(server.url + '/?lang=fr', {waitUntil: 'domcontentloaded', timeout: 30000});
    await page.locator('.taste-row').waitFor();
    await run({page, url: server.url});
    assert.deepEqual(errors, []);
  } finally { try { await browser?.close(); } finally { await server.close(); } }
}

for (const engine of browserTypes) {
  test(`${engine.name()}: the four filters accumulate and an empty list always offers a way out`, async () => {
    await isolated(engine, async ({page}) => {
      const rows = page.locator('.restaurant-row');
      const before = await rows.count();
      assert.ok(before > 0);
      await page.getByRole('button', {name: 'Moins de 25 min'}).click();
      await assert.doesNotReject(rows.first().waitFor());
      const fast = await rows.count();
      assert.ok(fast < before, 'le filtre de délai doit retirer des adresses');
      await page.getByRole('button', {name: 'Mieux notés'}).click();
      assert.ok(await rows.count() <= fast, 'les filtres se cumulent');
      // Une combinaison sans résultat n'affiche jamais une page blanche.
      await page.getByRole('button', {name: 'Pizzas'}).click();
      await page.locator('.no-results').waitFor();
      await page.locator('.no-results').getByRole('button', {name: 'Effacer les filtres'}).click();
      await assert.doesNotReject(rows.first().waitFor());
      assert.equal(await rows.count(), before);
      for (const name of ['Moins de 25 min', 'Mieux notés']) {
        assert.equal(await page.getByRole('button', {name}).getAttribute('aria-pressed'), 'false');
      }
    });
  });

  test(`${engine.name()}: a home offer carries a real code into the basket`, async () => {
    await isolated(engine, async ({page}) => {
      const card = page.locator('.bargain').first();
      const code = (await card.locator('p').innerText()).match(/[A-Z0-9]{3,}/)[0];
      await card.getByRole('button').click();
      await page.locator('.toast.visible').filter({hasText: code}).waitFor();
      await page.locator('.restaurant-row').filter({hasText: 'Ti Kaz Kréol'}).click();
      await page.locator('.product-card').first().click();
      await page.locator('.product-dialog').getByRole('button', {name: /^Ajouter ·/}).click();
      await page.getByRole('button', {name: 'Voir le panier', exact: true}).click();
      assert.equal(await page.getByRole('textbox', {name: 'Code promo'}).inputValue(), code);
      // Le serveur, et lui seul, décide de la remise : sous son minimum, il la refuse et l'explique.
      await page.getByRole('button', {name: 'Appliquer', exact: true}).click();
      await page.locator('.promo-block [role="alert"]').waitFor();
      assert.match(await page.locator('.promo-block [role="alert"]').innerText(), /\d+,\d{2}/);
      // Un code refusé n'est jamais réessayé en silence : le panier grossit, le client réapplique.
      await page.getByRole('button', {name: /^Ajouter un /}).first().click();
      assert.equal(await page.getByRole('textbox', {name: 'Code promo'}).inputValue(), code);
      await page.getByRole('button', {name: 'Appliquer', exact: true}).click();
      await page.waitForFunction(() => document.querySelector('.promo-applied b')?.textContent?.includes('−'));
      assert.match(await page.locator('.promo-applied b').innerText(), /−\s*\d/);
    });
  });

  test(`${engine.name()}: a struck starting price only appears when the code applies to that dish`, async () => {
    await isolated(engine, async ({page, url}) => {
      const offers = (await (await fetch(url + '/api/promotions')).json()).promotions
        .filter(offer => offer.restaurantId);
      assert.ok(offers.length, 'la démonstration propose au moins une offre par adresse');
      const restaurants = (await (await fetch(url + '/api/restaurants')).json()).restaurants;
      for (const offer of offers) {
        const restaurant = restaurants.find(item => item.id === offer.restaurantId);
        const main = restaurant.categories[0];
        const cheapest = Math.min(...restaurant.products.filter(item => item.available && item.group === main).map(item => item.price));
        const struck = page.locator('.restaurant-row').filter({hasText: restaurant.name}).locator('.restaurant-price s');
        const applies = offer.kind !== 'delivery' && cheapest >= offer.minimum;
        assert.equal(await struck.count(), applies ? 1 : 0, `${restaurant.name} (${offer.code})`);
        if (applies) assert.match(await struck.innerText(), new RegExp(String(Math.floor(cheapest / 100))));
      }
    });
  });

  test(`${engine.name()}: the offer rails open on their first card and the arrows stop at the ends`, async () => {
    await isolated(engine, async ({page}) => {
      // Les flèches n'existent que sur un rayon qui déborde ; celui des promotions déborde à 1280.
      const rail = page.locator('.rail-track').nth(1);
      const back = page.getByRole('button', {name: 'Offres précédentes'});
      assert.equal(await rail.evaluate(node => node.scrollLeft), 0);
      assert.equal(await back.isDisabled(), true);
      await page.getByRole('button', {name: 'Offres suivantes'}).click();
      // Le défilement est animé : la flèche ne se rouvre qu'une fois la position stabilisée.
      await page.waitForFunction(() => {
        const arrow = document.querySelector('.rail-arrow');
        return arrow instanceof HTMLButtonElement && !arrow.disabled;
      });
      assert.ok(await rail.evaluate(node => node.scrollLeft) > 0);
      await back.click();
      await page.waitForFunction(() => {
        const arrow = document.querySelector('.rail-arrow');
        return arrow instanceof HTMLButtonElement && arrow.disabled;
      });
      assert.equal(await rail.evaluate(node => node.scrollLeft), 0);
    });
  });

  test(`${engine.name()}: the phone header, the category rail and the tab bar fit a 390 px screen`, async () => {
    await isolated(engine, async ({page}) => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),
                   await page.evaluate(() => document.documentElement.clientWidth));
      const tabs = page.locator('.tab-bar');
      await tabs.waitFor();
      for (const label of ['Accueil', 'Offres', 'Panier', 'Compte']) {
        const box = await tabs.getByRole('button', {name: new RegExp(label)}).boundingBox();
        assert.ok(box.height >= 44, `${label}: cible tactile de ${box.height} px`);
      }
      await tabs.getByRole('button', {name: /Panier/}).click();
      await page.locator('.cart-panel').waitFor();
    }, {width: 390, height: 844});
  });
}
