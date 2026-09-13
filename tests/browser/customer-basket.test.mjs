import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer, browserTypes, api, login, saveCustomer, addMeal} from './helpers.mjs';

async function isolated(engine, run) {
  const server = await startServer();
  let browser;
  try {
    browser = await engine.launch({headless:true});
    const client = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
    await login(client, server.url); await saveCustomer(client, server.url);
    const page = await client.newPage();
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error=>errors.push(error.message));
    await page.goto(server.url + '/?lang=fr');
    await page.locator('.account-header-button').waitFor();
    await run({browser, client, page, url:server.url});
    assert.deepEqual(errors, []);
  } finally {try {await browser?.close();} finally {await server.close();}}
}

const storedCart = page => page.evaluate(()=>JSON.parse(localStorage.getItem('manjeo-cart-v2') || '[]'));
const orderId = page => page.locator('.order-ticket > div').first().locator('strong').innerText();
async function refreshCatalog(page) {
  const result = page.waitForResponse(response=>new URL(response.url()).pathname === '/api/restaurants');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await result;
}

async function assertReadableButton(button, container) {
  await button.scrollIntoViewIfNeeded();
  const box=await container.boundingBox();
  const content=await button.evaluate(element=>{
    const rect=element.getBoundingClientRect();
    const ranges=[];
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      if(!walker.currentNode.textContent.trim())continue;
      const range=document.createRange();range.selectNodeContents(walker.currentNode);
      for(const line of range.getClientRects())ranges.push({left:line.left,right:line.right,top:line.top,bottom:line.bottom});
    }
    return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,ranges};
  });
  assert.ok(content.left>=box.x-1 && content.right<=box.x+box.width+1,'The button fits horizontally inside its container');
  assert.ok(content.top>=box.y-1 && content.bottom<=box.y+box.height+1,'The complete button can be scrolled into view');
  for(const line of content.ranges)assert.ok(line.left>=content.left-1 && line.right<=content.right+1 && line.top>=content.top-1 && line.bottom<=content.bottom+1,'The visible button label fits inside the button');
}

for (const engine of browserTypes) {
  test(`${engine.name()}: cancellation checks the current status and keeps the conversation of an accepted order`, () => isolated(engine, async ({browser, client, page, url})=>{
    const restaurant = await browser.newContext(); await login(restaurant,url,'restaurant');
    const admin = await browser.newContext(); await login(admin,url,'admin');
    await addMeal(page); await page.locator('.cart-checkout').click();
    await page.locator('.order-ticket').waitFor(); const pendingId = await orderId(page);
    await page.locator('.customer-cancel').click();
    const cancel = page.locator('.cancel-dialog');
    assert.equal(await cancel.getByRole('button',{name:'Confirmer l’annulation',exact:true}).isDisabled(),true);
    await cancel.getByRole('textbox').fill('Changement du repas de test');
    const mutations = [];
    page.on('request', request=>{if(request.method()==='PATCH' && new URL(request.url()).pathname === `/api/orders/${pendingId}`)mutations.push(request.postDataJSON());});
    await cancel.getByRole('button',{name:'Confirmer l’annulation',exact:true}).click();
    await page.locator('.ticket-status').getByText('Annulée',{exact:true}).waitFor();
    assert.equal(mutations.length,1);
    assert.equal(await page.locator('.order-chat').count(),0,'A never-accepted order has no conversation');

    await page.getByRole('button',{name:'Découvrir d’autres adresses',exact:false}).click();
    await addMeal(page); await page.locator('.cart-checkout').click();
    await page.locator('.order-ticket').waitFor(); const acceptedId = await orderId(page);
    // Acceptance after opening the dialog must be checked again by the API.
    await page.locator('.customer-cancel').click();
    await cancel.getByRole('textbox').fill('Demande après ouverture du formulaire');
    await api(restaurant,url,`/api/orders/${acceptedId}`,'PATCH',{status:'accepted'});
    const rejected = page.waitForResponse(response=>response.request().method()==='PATCH' && new URL(response.url()).pathname===`/api/orders/${acceptedId}`);
    await cancel.getByRole('button',{name:'Confirmer l’annulation',exact:true}).click();
    assert.equal((await rejected).status(),409);
    await cancel.getByRole('alert').waitFor();
    assert.equal(await cancel.getByRole('textbox').inputValue(),'Demande après ouverture du formulaire');
    await page.keyboard.press('Escape');
    await page.locator('.order-chat').waitFor();
    const message = 'Merci pour votre aide concernant cette commande.';
    await page.locator('.order-chat').getByRole('textbox',{name:'Votre message',exact:true}).fill(message);
    await page.locator('.order-chat').getByRole('button',{name:'Envoyer',exact:true}).click();
    await page.locator('.chat-message').filter({hasText:message}).waitFor();
    await api(admin,url,`/api/orders/${acceptedId}`,'PATCH',{status:'cancelled',reason:'Annulation de démonstration après acceptation'});
    await page.reload(); await page.locator('.account-mobile-orders').click();
    const history = page.locator('.history-order').filter({hasText:acceptedId});
    await history.getByRole('button',{name:'Ouvrir la conversation',exact:false}).click();
    await page.locator('.chat-message').filter({hasText:message}).waitFor();
    assert.equal(await page.locator('.order-chat').getByRole('textbox',{name:'Votre message',exact:true}).isDisabled(),false,'The server keeps the accepted-order conversation writable for 30 minutes');
    assert.equal((await api(client,url,`/api/orders/${acceptedId}/thread`)).open,true);
    assert.equal(await page.locator('.customer-cancel').count(),0);
  }));

  test(`${engine.name()}: switching restaurants preserves the old basket until consent and rechecks its restaurant promotion`, () => isolated(engine, async ({page, url})=>{
    await addMeal(page);
    const cart = page.locator('.cart-sheet');
    await cart.locator('.cart-lines .stepper button').last().click();
    await cart.getByRole('textbox',{name:'Code promo',exact:true}).fill('TIKAZ5');
    await cart.getByRole('button',{name:'Appliquer',exact:true}).click();
    await cart.locator('.promo-line').waitFor();
    const before = await storedCart(page);
    await page.keyboard.press('Escape'); await page.locator('.brand').click();
    const rows = page.locator('.restaurant-row').filter({hasNotText:'Ti Kaz Kréol'});
    await rows.first().click();
    async function addOtherMeal() {
      await page.locator('.product-card').first().click();
      await page.locator('.product-dialog').getByRole('button',{name:/^Ajouter ·/}).click();
    }
    await addOtherMeal();
    await page.getByRole('button',{name:'Garder mon panier actuel',exact:true}).click();
    assert.deepEqual(await storedCart(page),before);
    await addOtherMeal();
    const check = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/promotions/check');
    await page.getByRole('button',{name:'Remplacer le panier',exact:true}).click();
    assert.equal((await check).status(),409);
    await page.locator('.header-cart').click();
    assert.equal(await cart.locator('.promo-line').count(),0);
    const after = await storedCart(page);
    assert.equal(after.length,1); assert.notEqual(after[0].restaurantId,before[0].restaurantId);
    assert.equal(after[0].quantity,1);
    await cart.locator('.cart-checkout').click(); await page.locator('.order-ticket').waitFor();
    const id = await orderId(page);
    const order = (await api(page.context(),url,'/api/orders')).orders.find(item=>item.id===id);
    assert.equal(order.restaurantId,after[0].restaurantId);
    assert.equal(order.promoCode,null); assert.equal(order.discount,0);
    assert.equal(order.total,after[0].price+order.delivery);
  }));

  test(`${engine.name()}: menu updates invalidate open products and baskets before refreshing prices, options and availability`, () => isolated(engine, async ({browser, client, page, url})=>{
    const restaurant = await browser.newContext(); await login(restaurant,url,'restaurant');
    let menu = (await api(restaurant,url,'/api/restaurants/ti-kreol/menu')).menu;
    const productId = menu.products[0].id;
    const editMenu = async update => {
      update(menu.products.find(product=>product.id===productId));
      menu=(await api(restaurant,url,'/api/restaurants/ti-kreol/menu','PATCH',menu)).menu;
      await refreshCatalog(page);
    };
    await page.locator('.restaurant-row').filter({hasText:'Ti Kaz Kréol'}).click();
    await page.locator('.product-card').first().click();
    const dialog=page.locator('.product-dialog');
    await editMenu(product=>{product.price+=300;});
    await dialog.getByText('Ce produit a changé depuis son ouverture.',{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:/^Ajouter ·/}).isDisabled(),true);
    await dialog.getByRole('button',{name:'Actualiser ce produit',exact:true}).click();
    await dialog.getByRole('button',{name:/^Ajouter ·/}).click();
    await page.locator('.header-cart').click();
    const cart=page.locator('.cart-sheet');
    const first = (await storedCart(page))[0];
    await editMenu(product=>{product.price+=200;});
    await cart.getByText('La carte a changé',{exact:true}).waitFor();
    assert.equal(await cart.locator('.cart-checkout').isDisabled(),true);
    await cart.getByRole('button',{name:'Mettre à jour mon panier',exact:true}).click();
    await page.waitForFunction(price=>JSON.parse(localStorage.getItem('manjeo-cart-v2')||'[]')[0]?.price===price,first.price+200);
    assert.equal(await cart.locator('.cart-checkout').isDisabled(),false);
    // Removing a chosen option must remove the line, never choose a different meal silently.
    const chosen = first.selections[0];
    await editMenu(product=>{const group=product.optionGroups.find(group=>group.id===chosen.groupId);group.choices=group.choices.filter(choice=>!chosen.choiceIds.includes(choice.id));});
    await cart.getByText('La carte a changé',{exact:true}).waitFor();
    await cart.getByRole('button',{name:'Mettre à jour mon panier',exact:true}).click();
    await cart.getByText('Une petite faim ?',{exact:true}).waitFor();
    assert.deepEqual(await storedCart(page),[]);
    await page.keyboard.press('Escape');
    await page.locator('.product-card').first().click();
    // A removed free default may require an explicit replacement selection.
    for(const fieldset of await dialog.locator('fieldset').all()) {
      if(await fieldset.locator('input:checked').count()===0)await fieldset.locator('input').first().check();
    }
    await dialog.getByRole('button',{name:/^Ajouter ·/}).click();
    await page.locator('.header-cart').click();
    await editMenu(product=>{product.available=false;});
    await cart.getByText('La carte a changé',{exact:true}).waitFor();
    assert.equal(await cart.locator('.cart-checkout').isDisabled(),true);
    await cart.getByRole('button',{name:'Mettre à jour mon panier',exact:true}).click();
    await cart.getByText('Une petite faim ?',{exact:true}).waitFor();
    assert.equal((await api(client,url,'/api/orders')).orders.length,0);
  }));

  test(`${engine.name()}: a price changed during confirmation requires consent to the new total and preserves the final receipt`, () => isolated(engine, async ({browser, client, page, url})=>{
    const restaurant = await browser.newContext(); await login(restaurant,url,'restaurant');
    let menu = (await api(restaurant,url,'/api/restaurants/ti-kreol/menu')).menu;
    await addMeal(page);
    const original = (await storedCart(page))[0];
    const requests = [];
    await page.route(url+'/api/orders',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      requests.push(route.request().postDataJSON());
      if(requests.length===1){
        // The menu changes after the customer's click, before server validation.
        menu.products.find(product=>product.id===original.productId).price+=350;
        menu=(await api(restaurant,url,'/api/restaurants/ti-kreol/menu','PATCH',menu)).menu;
      }
      await route.continue();
    });
    const rejected = page.waitForResponse(response=>response.request().method()==='POST' && new URL(response.url()).pathname==='/api/orders');
    await page.locator('.cart-checkout').click();
    const response = await rejected;
    assert.equal(response.status(),409); assert.equal((await response.json()).code,'order_not_created');
    const cart=page.locator('.cart-sheet');
    await cart.getByText('La carte a changé',{exact:true}).waitFor();
    assert.equal(await cart.locator('.cart-checkout').isDisabled(),true);
    assert.equal((await api(client,url,'/api/orders')).orders.length,0);
    assert.equal(await page.locator('.pending-order').count(),0,'A definitive rejection releases this UUID');
    await cart.getByRole('button',{name:'Mettre à jour mon panier',exact:true}).click();
    await page.waitForFunction(price=>JSON.parse(localStorage.getItem('manjeo-cart-v2')||'[]')[0]?.price===price,original.price+350);
    assert.equal(requests.length,1,'Refreshing a price never automatically confirms the order');
    await cart.locator('.cart-checkout').click(); await page.locator('.order-ticket').waitFor();
    assert.equal(requests.length,2); assert.notEqual(requests[1].requestId,requests[0].requestId);
    assert.equal(requests[1].expectedTotal,requests[0].expectedTotal+350);
    const id=await orderId(page);
    const receipt=(await api(client,url,'/api/orders')).orders.find(order=>order.id===id);
    assert.equal(receipt.total,requests[1].expectedTotal);
    const product=menu.products.find(product=>product.id===original.productId);
    product.price+=200; product.name='Nouvelle recette pour les commandes suivantes';
    await api(restaurant,url,'/api/restaurants/ti-kreol/menu','PATCH',menu);
    await page.reload(); await page.locator('.active-order-card').getByRole('button',{name:'Suivre la livraison',exact:true}).click();
    const unchanged=(await api(client,url,'/api/orders')).orders.find(order=>order.id===id);
    assert.deepEqual(unchanged.items,receipt.items); assert.equal(unchanged.total,receipt.total);
    assert.equal(await page.locator('.order-ticket').getByText(product.name,{exact:false}).count(),0);
  }));

  test(`${engine.name()}: long customer details leave account buttons and checkout controls readable in all three languages`, () => isolated(engine, async ({client, page, url})=>{
    const name=('Camille '+'Alexandrine'.repeat(10)).slice(0,100);
    const details=('Bâtiment du jardin, étage supérieur, sonnette '+'Interphone'.repeat(30)).slice(0,300);
    const saved=(await api(client,url,'/api/session')).user.deliveryAddress;
    await api(client,url,'/api/profile','PATCH',{name,deliveryAddress:{address:saved.address,city:saved.city,details}});
    for(const lang of ['fr','ht','pt'])for(const width of [320,390,430]){
      await page.setViewportSize({width,height:844});
      await page.goto(url+'/?lang='+lang);
      await page.locator('.account-header-button').click();
      const modal=page.locator('.account-dialog');
      await page.locator('.customer-profile-form').waitFor();
      assert.equal(await page.locator('.customer-profile-form input[autocomplete="name"]').inputValue(),name);
      assert.equal(await page.locator('.customer-profile-form input[maxlength="300"]').inputValue(),details);
      const buttons=modal.locator('button[data-slot="button"]');
      assert.equal(await buttons.count(),2);
      for(const button of await buttons.all())await assertReadableButton(button,modal);
      assert.equal(await modal.evaluate(element=>element.scrollLeft),0,'A clipped modal cannot pass just because the document itself is narrow');
      const overflow=await modal.evaluate(element=>[...element.querySelectorAll('h2,.payment-methods label,.address-verification')].some(child=>child.scrollWidth>child.clientWidth+1));
      assert.equal(overflow,false,`${lang} ${width}: account headings, address and payment labels fit`);
      await page.keyboard.press('Escape');
      if(!(await storedCart(page)).length){
        await page.locator('.restaurant-row').filter({hasText:'Ti Kaz Kréol'}).click();
        await page.locator('.product-card').first().click();
        await page.locator('.add-product-row > button').click();
      }
      await page.locator('.header-cart').click();
      await page.locator('.quick-order-summary button').click();
      const input=page.locator('.checkout-form input[name="name"]');
      assert.equal(await input.inputValue(),name); assert.equal(await input.getAttribute('maxlength'),'100');
      const detailsInput=page.locator('.checkout-form input[name="details"]');
      assert.equal(await detailsInput.inputValue(),details); assert.equal(await detailsInput.getAttribute('maxlength'),'300');
      await assertReadableButton(page.locator('.checkout-account-note button'),page.locator('.checkout-account-note'));
      const note=await page.locator('.checkout-account-note').boundingBox();
      assert.ok(note.x>=0 && note.x+note.width<=width,'The checkout account note stays in the viewport');
    }
    // The full saved name is valid for one-click ordering, without silent truncation.
    await page.goto(url+'/?lang=fr');await page.locator('.header-cart').click();
    await page.locator('.cart-checkout').click();await page.locator('.order-ticket').waitFor();
    const id=await orderId(page);
    const order=(await api(client,url,'/api/orders')).orders.find(item=>item.id===id);
    assert.equal(order.customerName,name); assert.equal(order.details,details);
  }));
}
