import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {customerProfileChanges, customerProfileDraft} from '../app/customer-state.ts';

const user = {id:'customer-a',role:'client',name:'Camille',phone:'0694010203',language:'fr',paymentMethod:'demo',
  deliveryAddress:{address:'7 Rue Lallouette',city:'Cayenne',details:'Portail bleu',verificationExpiresAt:'2000-01-01T00:00:00Z'}};
function extract(path, name) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function walk(node) {if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(source);ts.forEachChild(node, walk);}
  walk(source);assert.ok(found, `Actual function ${name} must be tested`);
  return ts.transpileModule(found, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
}
const saveCode = extract('../app/customer-account.tsx', 'save');
const matchesCode = extract('../app/address-verification.tsx', 'savedAddressMatches');
function form(options = {}) {
  const patches = [], notices = [], errors = [];
  const current = structuredClone(user);
  const context = vm.createContext({
    exports:{}, user:current, ...customerProfileDraft(current), candidate:null, disabled:false,
    saving:{current:false}, mounted:{current:true}, customerProfileChanges, getLanguage:()=>options.language || 'fr',
    setBusy() {}, setError:value=>errors.push(value), setNotice:value=>notices.push(value), setCandidate() {},
    onSaveProfile:async payload=>{patches.push(payload);return options.save ? options.save(payload) : current;},
  });
  vm.runInContext(matchesCode + '\n' + saveCode, context);
  return {context, patches, notices, errors, save:()=>context.save({preventDefault(){}})};
}

test('editing only the phone succeeds even when the unchanged saved address has expired', async () => {
  const account = form();account.context.phone = '0694 99 88 77';
  await account.save();
  assert.deepEqual(account.patches, [{phone:'0694 99 88 77'}]);
  assert.equal(account.notices.at(-1), 'Vos coordonnées sont enregistrées.');
});

test('unchanged fields and whitespace-only formatting do not overwrite a refreshed profile', () => {
  const draft = {...customerProfileDraft(user),name:' Camille ',phone:' 0694010203 ',address:' 7 Rue Lallouette ',details:' Portail bleu '};
  assert.deepEqual(customerProfileChanges(draft,user,'fr',null),{});
  const updated = {...user,name:'Nom plus récent'};
  assert.deepEqual(customerProfileChanges({...customerProfileDraft(updated),phone:'0694998877'},updated,'fr',null),{phone:'0694998877'});
});

test('a new address still needs a proof that is valid at the exact save click', async () => {
  const account = form();
  account.context.address = '9 Rue Lallouette';
  account.context.candidate = {address:'9 Rue Lallouette',city:'Cayenne',verificationToken:'a'.repeat(43),expiresAt:new Date(Date.now()-1).toISOString()};
  await account.save();
  assert.equal(account.patches.length,0);
  assert.match(account.errors.at(-1),/Confirmez le point/);
  account.context.candidate.expiresAt = new Date(Date.now()+60000).toISOString();
  await account.save();
  assert.deepEqual(account.patches,[{deliveryAddress:{address:'9 Rue Lallouette',city:'Cayenne',details:'Portail bleu',verificationToken:'a'.repeat(43)}}]);
});

test('explicit deletion of an expired address does not require its old proof', async () => {
  const account = form();account.context.address = '';
  await account.save();
  assert.deepEqual(account.patches,[{deliveryAddress:null}]);
});

test('re-verifying the same address sends the fresh proof without rewriting contact fields', () => {
  const proof = {address:user.deliveryAddress.address,city:'Cayenne',verificationToken:'b'.repeat(43)};
  assert.deepEqual(customerProfileChanges(customerProfileDraft(user),user,'fr',proof),{deliveryAddress:{address:'7 Rue Lallouette',city:'Cayenne',details:'Portail bleu',verificationToken:'b'.repeat(43)}});
});

test('saving an unchanged profile is a local acknowledgement without an invalid empty PATCH', async () => {
  const account = form();await account.save();
  assert.equal(account.patches.length,0);
  assert.equal(account.notices.at(-1),'Vos coordonnées sont enregistrées.');
});

test('the profile submit lock survives repeated clicks and unlocks after failure', async () => {
  let reject;
  const account = form({save:()=>new Promise((_resolve,fail)=>{reject=fail;})});
  account.context.phone = '0694998877';
  const first = account.save();await account.save();
  assert.equal(account.patches.length,1);
  reject(new Error('Temporary failure'));await first;
  assert.equal(account.context.saving.current,false);
  assert.equal(account.errors.at(-1),'Temporary failure');
});

test('a response after the account dialog closes cannot announce a save in its replacement', async () => {
  let resolve;
  const account = form({save:()=>new Promise(done=>{resolve=done;})});
  account.context.phone = '0694998877';
  const save = account.save();account.context.mounted.current = false;
  resolve(user);await save;
  assert.equal(account.notices.includes('Vos coordonnées sont enregistrées.'),false);
});
