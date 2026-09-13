import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, browserTypes, login, api} from './helpers.mjs';

const widths = [320, 390, 430, 521, 600, 768, 860, 861, 1024, 1280];
const languages = [['fr', 'Français'], ['ht', 'Kreyòl ayisyen'], ['pt', 'Português (Brasil)']];

async function chooseLanguage(page, language, name) {
  const trigger = page.locator('.language-trigger');
  await page.waitForFunction(element => !element.disabled, await trigger.elementHandle());
  const changed = await page.locator('html').getAttribute('lang') !== (language === 'pt' ? 'pt-BR' : language);
  await trigger.click();
  const saved = changed ? page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/profile') : null;
  await page.getByRole('menuitemradio', {name, exact: true}).click();
  if (saved) { const response = await saved; assert.equal(response.status(), 200); assert.equal((await response.json()).user.language, language); }
  await page.locator('.language-menu').waitFor({state: 'hidden'});
  await page.waitForFunction(element => !element.disabled, await trigger.elementHandle());
}

async function checkHeader(page, role, language, filled = false) {
  const header = page.locator(role === 'client' ? '.site-header' : '.staff-header');
  const trigger = header.locator('.language-trigger');
  await trigger.waitFor();
  await page.waitForFunction(element => !element.disabled, await trigger.elementHandle());
  assert.equal(await page.locator('.language-trigger').count(), 1);
  assert.equal(await page.locator('.language-bar').count(), 0);
  for (const width of widths) {
    await page.setViewportSize({width, height: 844});
    const geometry = await header.evaluate(element => ({
      documentWidth: document.documentElement.scrollWidth,
      controls: [...element.querySelectorAll('button')].filter(button => button.getClientRects().length).map(button => ({
        label: button.getAttribute('aria-label') || button.textContent,
        bounds: button.getBoundingClientRect().toJSON(),
      })),
    }));
    const label = `${role}/${language}/${width}/${filled ? 'large basket' : 'empty basket'}`;
    assert.ok(geometry.documentWidth <= width + 1, `${label}: document overflows to ${geometry.documentWidth}`);
    for (const control of geometry.controls) {
      assert.ok(control.bounds.x >= 0 && control.bounds.right <= width + 1, `${label}: ${control.label} is clipped`);
      assert.ok(control.bounds.width >= 20, `${label}: ${control.label} is collapsed`);
    }
    if (role === 'client') {
      const cart = await header.locator('.header-cart').boundingBox();
      const languageButton = await trigger.boundingBox();
      // La refonte de l'accueil place la pastille de langue à gauche du compte et du panier.
      assert.ok(languageButton.x + languageButton.width <= cart.x + 1, `${label}: language must precede basket`);
      assert.ok(Math.abs(languageButton.y + languageButton.height / 2 - cart.y - cart.height / 2) < 3, `${label}: language and basket share a row`);
      assert.equal(await header.locator('.language-selector').evaluate(element => element.nextElementSibling?.classList.contains('account-header-button')), true);
      assert.ok(await header.locator('.location-button').isVisible());
      assert.ok(await header.locator('.account-header-button').isVisible());
    }
    await trigger.focus();
    await page.waitForFunction(element => element === document.activeElement, await trigger.elementHandle());
    await page.keyboard.press('Enter');
    const menu = page.locator('.language-menu');
    await menu.waitFor().catch(async error => {
      const state = await trigger.evaluate(element => ({disabled: element.disabled, state: element.dataset.state, focus: document.activeElement?.outerHTML.slice(0, 500)}));
      throw new Error(`${label}: menu did not open ${JSON.stringify(state)}`, {cause: error});
    });
    const menuBounds = await menu.boundingBox(), triggerBounds = await trigger.boundingBox();
    assert.ok(menuBounds.y >= triggerBounds.y + triggerBounds.height - 1, `${label}: menu opens downward`);
    assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width + 1, `${label}: menu fits viewport`);
    await page.keyboard.press('Escape');
    await menu.waitFor({state: 'hidden'});
    await page.waitForFunction(element => element === document.activeElement, await trigger.elementHandle());
  }
}

for (const engine of browserTypes) {
  test(`${engine.name()}: integrated language menu stays reachable beside the basket and across all role headers`, async () => {
    const server = await startServer(); let browser;
    try {
      browser = await engine.launch({headless: true});
      for (const role of ['client', 'restaurant', 'courier', 'admin']) {
        const context = await browser.newContext({viewport: {width: 1280, height: 844}, reducedMotion: 'reduce'});
        await login(context, server.url, role);
        await api(context, server.url, '/api/profile', 'PATCH', {name: 'Camille ' + 'Alexandrine'.repeat(8), language: 'fr'});
        const page = await context.newPage(); page.setDefaultTimeout(15000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        // Only the browser's public catalogue changes, to exercise a long total.
        // No order is placed and no restaurant menu is published by this test.
        if (role === 'client') await page.route('**/api/restaurants', async route => {
          const response = await route.fetch(), data = await response.json();
          data.restaurants.find(restaurant => restaurant.id === 'ti-kreol').products[0].price = 49999;
          await route.fulfill({response, json: data});
        });
        await page.goto(server.url + '/?lang=fr');
        await page.locator(role === 'client' ? '.restaurant-row' : '.staff-app').first().waitFor();
        const trigger = page.locator('.language-trigger');
        for (const [language, name] of languages) {
          await chooseLanguage(page, language, name);
          await checkHeader(page, role, language);
        }
        if (role === 'client') {
          await chooseLanguage(page, 'fr', 'Français');
          await page.locator('.restaurant-row').filter({hasText: 'Ti Kaz Kréol'}).click();
          await page.locator('.product-card').first().click();
          const dialog = page.locator('.product-dialog');
          for (let index = 1; index < 20; index++) await dialog.getByRole('button', {name: 'Augmenter la quantité', exact: true}).click();
          await dialog.getByRole('button', {name: /^Ajouter ·/}).click();
          for (const [language, name] of languages) {
            await chooseLanguage(page, language, name);
            await checkHeader(page, role, language, true);
          }
        }
        assert.deepEqual(errors, []);
        await context.close();
      }
    } finally { try { await browser?.close(); } finally { await server.close(); } }
  });
}
