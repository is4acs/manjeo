import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as i18n from '../lib/i18n.ts';

const source=readFileSync(new URL('../app/i18n.tsx',import.meta.url),'utf8');
const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const storageKey='manjeo-language-v1';

// Keep real locale resolution and persistence code, with fresh browser lifetimes.
function browser({url='https://manjeo.test/',storage=new Map(),cookies=new Map(),blockedStorage=false,languages=['fr']}={}) {
 i18n.setLanguageValue('fr');
 const exports={},listeners=new Map(),cookieWrites=[];
 const location=new URL(url);
 const document={};
 Object.defineProperty(document,'cookie',{get:()=>[...cookies].map(([key,value])=>`${key}=${value}`).join('; '),set:value=>{cookieWrites.push(value);const [key,data]=value.split(';')[0].split('=');cookies.set(key,data);}});
 vm.runInNewContext(javascript,{
  exports,URL,document,location,navigator:{languages,language:languages[0]},
  history:{state:{navigation:'kept'},replaceState(state,_title,value){assert.equal(state.navigation,'kept');location.href=String(value);}},
  localStorage:{getItem(key){if(blockedStorage)throw new Error('Storage blocked');return storage.get(key)??null;},setItem(key,value){if(blockedStorage)throw new Error('Storage blocked');storage.set(key,value);}},
  window:{addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(listener);}},
  require(name){if(name==='@/lib/i18n')return i18n;if(['react','react/jsx-runtime','lucide-react','radix-ui','./i18n.css'].includes(name))return {};throw new Error('Unexpected import: '+name);},
 });
 return {...exports,storage,cookies,cookieWrites,location,listeners,dispatch(event){for(const listener of listeners.get('storage')||[])listener(event);}};
}

test('an explicit URL wins initially, then choosing a language updates that URL without losing navigation',()=>{
 const app=browser({url:'https://manjeo.test/?lang=pt-BR&restaurant=ti-kaz#menu',storage:new Map([[storageKey,'ht']])});
 app.initializeLanguage();assert.equal(i18n.getLanguage(),'pt');assert.equal(app.hasLanguageChoice(),true);
 app.chooseLanguage('fr');
 assert.equal(app.location.searchParams.get('lang'),'fr');assert.equal(app.location.searchParams.get('restaurant'),'ti-kaz');assert.equal(app.location.hash,'#menu');
});

test('a chosen language survives refresh and another route and cannot be reset by a different account preference',()=>{
 const app=browser();app.initializeLanguage();app.chooseLanguage('ht');
 assert.equal(app.storage.get(storageKey),'ht');assert.equal(app.cookies.get('manjeo-locale'),'ht');
 assert.match(app.cookieWrites.at(-1),/Path=\/; Max-Age=31536000; SameSite=Lax; Secure$/);
 const reloaded=browser({url:'https://manjeo.test/?restaurant=ti-kaz',storage:app.storage,cookies:app.cookies});
 reloaded.initializeLanguage();reloaded.adoptProfileLanguage('pt');
 assert.equal(i18n.getLanguage(),'ht');assert.equal(reloaded.hasLanguageChoice(),true);
});

test('a cookie preserves language when browser storage is unavailable, including a later choice',()=>{
 const app=browser({blockedStorage:true,cookies:new Map([['manjeo-locale','pt']]),languages:['ht']});
 app.initializeLanguage();assert.equal(i18n.getLanguage(),'pt');
 app.chooseLanguage('ht');
 const reloaded=browser({blockedStorage:true,cookies:app.cookies});reloaded.initializeLanguage();
 assert.equal(i18n.getLanguage(),'ht');assert.equal(reloaded.hasLanguageChoice(),true);
});

test('a fresh browser uses its supported language, then the account until the user makes an explicit choice',()=>{
 const app=browser({languages:['es-ES','pt-BR']});app.initializeLanguage();
 assert.equal(i18n.getLanguage(),'pt');assert.equal(app.hasLanguageChoice(),false);assert.equal(app.storage.size,0);
 app.adoptProfileLanguage('ht');assert.equal(i18n.getLanguage(),'ht');
 app.chooseLanguage('fr');app.adoptProfileLanguage('pt');assert.equal(i18n.getLanguage(),'fr');
});

test('another tab updates the visible language and stale URL while unrelated or removed storage does not reset it',()=>{
 const app=browser({url:'https://manjeo.test/?lang=fr'});app.initializeLanguage();app.initializeLanguage();
 assert.equal(app.listeners.get('storage').length,1);
 app.dispatch({key:storageKey,newValue:'ht'});
 assert.equal(i18n.getLanguage(),'ht');assert.equal(app.location.searchParams.get('lang'),'ht');
 for(const event of [{key:'manjeo-session-change',newValue:'fr'},{key:storageKey,newValue:null},{key:storageKey,newValue:'de'}])app.dispatch(event);
 assert.equal(i18n.getLanguage(),'ht');
});

test('unsupported persisted or runtime values fall back safely without corrupting a valid choice',()=>{
 const app=browser({url:'http://127.0.0.1:5188/?lang=unsupported',storage:new Map([[storageKey,'unknown']]),cookies:new Map([['manjeo-locale','bad']]),languages:['es']});
 app.initializeLanguage();assert.equal(i18n.getLanguage(),'fr');assert.equal(app.hasLanguageChoice(),false);
 app.chooseLanguage('ht');app.chooseLanguage('unknown');
 assert.equal(i18n.getLanguage(),'ht');assert.equal(app.storage.get(storageKey),'ht');assert.doesNotMatch(app.cookieWrites.at(-1),/Secure/);
});
