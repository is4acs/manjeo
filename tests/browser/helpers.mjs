import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {chromium, firefox, webkit} from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const available = {chromium, firefox, webkit};
export const browserTypes = (process.env.MANJEO_TEST_BROWSERS || 'chromium').split(',').map(name => {
  assert.ok(Object.hasOwn(available, name), `Unknown browser ${name}`);
  return available[name];
});

/** Always starts a fresh localhost database; no external URL is accepted. */
export async function startServer() {
  const venv = root + '.venv/bin/python';
  const child = spawn(existsSync(venv) ? venv : 'python3', ['tests/browser/server.py'], {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
  let diagnostic = '';
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4000); });
  const lines = createInterface({input: child.stdout});
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Browser test server did not start. ' + diagnostic)); }, 20000);
    const failed = error => { clearTimeout(timer); reject(error); };
    child.once('error', failed);
    child.once('exit', code => failed(new Error(`Browser test server exited (${code}). ${diagnostic}`)));
    lines.on('line', line => {
      if (!/^MANJEO_BROWSER_TEST_URL=http:\/\/127\.0\.0\.1:\d+$/.test(line)) return;
      clearTimeout(timer); resolve(line.split('=')[1]);
    });
  });
  return {
    url,
    async close() {
      lines.close();
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise(resolve => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGINT');
      });
    },
  };
}

export async function api(context, url, path, method = 'GET', data) {
  const response = await context.request.fetch(url + path, {method, data});
  const body = await response.json();
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(body)}`);
  return body;
}
export async function login(context, url, role = 'client') {
  return api(context, url, '/api/login', 'POST', {email: `${role === 'courier' ? 'livreur' : role}@manjeo.test`, password: 'ManjeoDemo2026!'});
}
export async function saveCustomer(context, url) {
  const candidate = (await api(context, url, '/api/addresses/verify', 'POST', {address: '7 Rue Lallouette', city: 'Cayenne'})).candidates[0];
  return (await api(context, url, '/api/profile', 'PATCH', {name: 'Camille Test', phone: '0694010203', language: 'fr', paymentMethod: 'demo',
    deliveryAddress: {address: candidate.address, city: candidate.city, details: 'Portail bleu', verificationToken: candidate.verificationToken}})).user;
}
export async function addMeal(page) {
  await page.locator('.restaurant-row').filter({hasText: 'Ti Kaz Kréol'}).click();
  await page.locator('.product-card').first().click();
  await page.locator('.product-dialog').getByRole('button', {name: /^Ajouter ·/}).click();
  await page.getByRole('button', {name: 'Voir le panier', exact: true}).click();
}
