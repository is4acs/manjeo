import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, browserTypes} from './helpers.mjs';

async function isolated(engine, run) {
  const server = await startServer();
  let browser;
  try {
    browser = await engine.launch({headless: true});
    const context = await browser.newContext({viewport: {width: 390, height: 844}, reducedMotion: 'reduce'});
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await run(page, server.url);
    assert.deepEqual(errors, []);
  } finally { try { await browser?.close(); } finally { await server.close(); } }
}

async function keyboardClick(page, target) {
  await target.focus(); await page.keyboard.press('Enter');
}
async function focused(page, target) {
  await target.waitFor({state: 'visible'});
  await page.waitForFunction(element => document.activeElement === element, await target.elementHandle());
}
async function tab(page, backwards = false) {
  // Safari on macOS uses Option-Tab to include every native control when full
  // keyboard access is not enabled in the host's settings.
  const allControls = process.platform === 'darwin' && page.context().browser().browserType().name() === 'webkit';
  await page.keyboard.press(`${backwards ? 'Shift+' : ''}${allControls ? 'Alt+' : ''}Tab`);
}
async function opened(page, url) {
  await page.goto(url + '/?lang=fr'); await page.locator('.account-header-button').waitFor();
}
async function openFirstProduct(page, restaurant = 'Ti Kaz Kréol') {
  await keyboardClick(page, page.locator('.restaurant-row').filter({hasText: restaurant}));
  await keyboardClick(page, page.locator('.product-card').first());
  await page.locator('.product-dialog').waitFor();
}
async function addProduct(page) {
  await keyboardClick(page, page.locator('.product-dialog').getByRole('button', {name: /^Ajouter ·/}));
  await page.locator('.product-dialog').waitFor({state: 'hidden'});
}

for (const engine of browserTypes) {
  test(`${engine.name()}: language arrows, Home, End and Escape preserve the keyboard trigger`, () => isolated(engine, async (page, url) => {
    await opened(page, url);
    const trigger = page.locator('.language-trigger');
    await trigger.focus(); await page.keyboard.press('ArrowDown');
    await focused(page, page.getByRole('menuitemradio', {name: 'Français', exact: true}));
    await page.keyboard.press('End');
    await focused(page, page.getByRole('menuitemradio', {name: 'Português (Brasil)', exact: true}));
    await page.keyboard.press('ArrowUp');
    await focused(page, page.getByRole('menuitemradio', {name: 'Kreyòl ayisyen', exact: true}));
    await page.keyboard.press('Home');
    await focused(page, page.getByRole('menuitemradio', {name: 'Français', exact: true}));
    await page.keyboard.press('Escape'); await focused(page, trigger);
    await page.keyboard.press('ArrowDown');
    await focused(page, page.getByRole('menuitemradio', {name: 'Français', exact: true}));
    await page.keyboard.press('End');
    await focused(page, page.getByRole('menuitemradio', {name: 'Português (Brasil)', exact: true}));
    await page.keyboard.press('Enter');
    await focused(page, trigger);
    assert.match(await trigger.getAttribute('aria-label'), /Português \(Brasil\)$/);
    await page.reload(); await trigger.waitFor();
    assert.match(await trigger.getAttribute('aria-label'), /Português \(Brasil\)$/, 'Keyboard selection survives a reload even when the compact header hides the visible label');
  }));

  test(`${engine.name()}: address Escape closes only suggestions and nested dialogs restore their own trigger`, () => isolated(engine, async (page, url) => {
    await opened(page, url);
    const location = page.locator('.location-button');
    await keyboardClick(page, location);
    const form = page.locator('.location-form');
    const address = form.getByRole('combobox', {name: 'Adresse de livraison', exact: true});
    await address.focus(); await page.keyboard.type('7 Rue');
    const suggestions = page.locator('.address-list'); await suggestions.waitFor();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
    await suggestions.waitFor({state: 'hidden'});
    assert.equal(await form.isVisible(), true, 'The first Escape must leave the address form open');
    await focused(page, address);
    assert.equal(await address.inputValue(), '7 Rue');
    await page.keyboard.press('ArrowDown'); await suggestions.waitFor();
    const options = suggestions.getByRole('option');
    assert.equal(await address.getAttribute('aria-activedescendant'), await options.first().getAttribute('id'), 'ArrowDown reopens at the first suggestion');
    assert.equal(await address.inputValue(), '7 Rue', 'Reopening suggestions never edits the address');
    await page.keyboard.press('Escape'); await suggestions.waitFor({state: 'hidden'});
    await page.keyboard.press('ArrowUp'); await suggestions.waitFor();
    assert.equal(await address.getAttribute('aria-activedescendant'), await options.last().getAttribute('id'), 'ArrowUp reopens at the last suggestion');
    const expected = await options.last().locator('strong').innerText();
    await page.keyboard.press('Enter');
    assert.equal(await address.inputValue(), expected);
    await suggestions.waitFor({state: 'hidden'});
    assert.equal(await form.isVisible(), true, 'Enter selects an address without submitting the enclosing form');
    await page.keyboard.press('Escape'); await form.waitFor({state: 'hidden'}); await focused(page, location);

    await openFirstProduct(page); await addProduct(page);
    const cartTrigger = page.locator('.header-cart');
    await keyboardClick(page, cartTrigger); const cart = page.locator('.cart-sheet'); await cart.waitFor();
    const change = cart.getByRole('button', {name: 'Changer', exact: true});
    await keyboardClick(page, change); await form.waitFor();
    await keyboardClick(page, form.getByRole('button', {name: 'Valider mon adresse'}));
    await form.waitFor({state: 'hidden'});
    assert.equal(await cart.isVisible(), true); await focused(page, change);
    await page.keyboard.press('Escape'); await cart.waitFor({state: 'hidden'}); await focused(page, cartTrigger);
  }));

  test(`${engine.name()}: required choices and replacement dialogs remain reachable without losing keyboard focus`, () => isolated(engine, async (page, url) => {
    // Only public menu data is changed; no restaurant or production data is written.
    await page.route('**/api/restaurants', async route => {
      const response = await route.fetch(); const data = await response.json();
      data.restaurants.find(restaurant => restaurant.id === 'ti-kreol').products[0].optionGroups = [{
        id: 'sides', name: 'Deux accompagnements', min: 2, max: 2,
        choices: [{id: 'rice', name: 'Riz', price: 0}, {id: 'salad', name: 'Salade', price: 0}, {id: 'banana', name: 'Banane', price: 0}],
      }];
      await route.fulfill({response, json: data});
    });
    await opened(page, url);
    const account = page.locator('.account-header-button');
    await keyboardClick(page, account); await page.locator('.account-dialog').waitFor();
    await page.keyboard.press('Escape'); await page.locator('.account-dialog').waitFor({state: 'hidden'}); await focused(page, account);

    await openFirstProduct(page); const productCard = page.locator('.product-card').first();
    const dialog = page.locator('.product-dialog'); const choices = dialog.getByRole('checkbox');
    const add = dialog.getByRole('button', {name: /^Ajouter ·/});
    assert.equal(await add.isDisabled(), true);
    await choices.first().focus(); await page.keyboard.press('Space');
    assert.equal(await add.isDisabled(), true);
    await tab(page); await focused(page, choices.nth(1)); await page.keyboard.press('Space');
    assert.equal(await add.isDisabled(), false); assert.equal(await choices.nth(2).isDisabled(), true);
    await tab(page, true); await page.keyboard.press('Space');
    assert.equal(await add.isDisabled(), true); assert.equal(await choices.nth(2).isDisabled(), false);
    await tab(page); await tab(page); await focused(page, choices.nth(2)); await page.keyboard.press('Space');
    assert.equal(await add.isDisabled(), false);
    await addProduct(page); await focused(page, productCard);

    await keyboardClick(page, page.locator('.brand'));
    await keyboardClick(page, page.locator('.restaurant-row').filter({hasNotText: 'Ti Kaz Kréol'}).first());
    const otherProduct = page.locator('.product-card').first(); await keyboardClick(page, otherProduct);
    await addProduct(page);
    const replace = page.getByRole('button', {name: 'Remplacer le panier', exact: true});
    const keep = page.getByRole('button', {name: 'Garder mon panier actuel', exact: true});
    await focused(page, replace);
    // Give the previous product dialog's deferred close autofocus time to run.
    await page.waitForTimeout(100); await focused(page, replace);
    await tab(page); await focused(page, keep); await page.keyboard.press('Enter');
    await keep.waitFor({state: 'hidden'}); await focused(page, otherProduct);

    await keyboardClick(page, page.locator('.header-cart')); const cart = page.locator('.cart-sheet'); await cart.waitFor();
    await keyboardClick(page, cart.locator('.cart-checkout'));
    const accountDialog = page.locator('.account-dialog'); await accountDialog.waitFor();
    await cart.waitFor({state: 'hidden'});
    await page.waitForFunction(element => element.contains(document.activeElement), await accountDialog.elementHandle());
    await page.waitForTimeout(100);
    assert.equal(await accountDialog.evaluate(element => element.contains(document.activeElement)), true, 'The closing cart must not steal focus from the login dialog');
  }));
}
