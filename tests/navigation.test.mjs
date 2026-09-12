import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationLinks} from '../lib/navigation.ts';

test('stored coordinates take precedence and produce directions in all three navigation apps',()=>{
 const links=navigationLinks({address:'Ancien libellé',city:'Cayenne',latitude:4.9381,longitude:-52.326});
 assert.equal(links.usesCoordinates,true);
 const google=new URL(links.googleMaps),waze=new URL(links.waze),apple=new URL(links.appleMaps);
 assert.equal(google.origin,'https://www.google.com');assert.equal(google.pathname,'/maps/dir/');
 assert.equal(google.searchParams.get('api'),'1');assert.equal(google.searchParams.get('destination'),'4.9381,-52.326');assert.equal(google.searchParams.get('dir_action'),'navigate');
 assert.equal(waze.origin,'https://waze.com');assert.equal(waze.searchParams.get('ll'),'4.9381,-52.326');assert.equal(waze.searchParams.get('navigate'),'yes');assert.equal(waze.searchParams.has('q'),false);
 assert.equal(apple.origin,'https://maps.apple.com');assert.equal(apple.searchParams.get('daddr'),'4.9381,-52.326');assert.equal(apple.searchParams.get('dirflg'),'d');
 for(const link of [google,waze,apple])assert.equal(link.toString().includes('Ancien'),false);
});

test('legacy addresses remain text searches with their city and cannot inject URL parameters',()=>{
 const address='12 rue d’Été & destination=ailleurs #porte';
 const links=navigationLinks({address,city:'Rémire-Montjoly'});
 const target=address+', Rémire-Montjoly, Guyane française';
 assert.equal(links.usesCoordinates,false);
 assert.equal(new URL(links.googleMaps).searchParams.get('destination'),target);
 assert.equal(new URL(links.waze).searchParams.get('q'),target);assert.equal(new URL(links.waze).searchParams.has('ll'),false);
 assert.equal(new URL(links.appleMaps).searchParams.get('daddr'),target);
 for(const href of [links.googleMaps,links.waze,links.appleMaps]){const url=new URL(href);assert.equal(url.hash,'');assert.equal(url.searchParams.getAll('destination').length,url.hostname==='www.google.com'?1:0);}
});

test('incomplete, non-finite or out-of-range coordinates fall back to the address without inventing a pin',()=>{
 for(const coordinates of [{latitude:4.9},{longitude:-52.3},{latitude:NaN,longitude:-52.3},{latitude:4.9,longitude:Infinity},{latitude:91,longitude:0},{latitude:0,longitude:-181},{latitude:'4.9',longitude:-52.3}]){
  const links=navigationLinks({address:'12 rue Lallouette',city:'Cayenne',...coordinates});
  assert.equal(links.usesCoordinates,false);assert.equal(new URL(links.waze).searchParams.has('ll'),false);
  assert.match(new URL(links.googleMaps).searchParams.get('destination'),/^12 rue Lallouette/);
 }
});

test('no destination produces no link, while zero coordinates are retained instead of mistaken for absence',()=>{
 assert.equal(navigationLinks({address:'  ',city:'Cayenne'}),null);
 assert.equal(navigationLinks({address:'',city:'',latitude:NaN,longitude:0}),null);
 const links=navigationLinks({address:'',city:'',latitude:0,longitude:0});
 assert.equal(links.usesCoordinates,true);assert.equal(new URL(links.googleMaps).searchParams.get('destination'),'0,0');
});

test('creating directions never changes the saved delivery address',()=>{
 const destination=Object.freeze({address:'  12 rue Lallouette  ',city:' Cayenne ',latitude:4.9381,longitude:-52.326});
 const copy={...destination};navigationLinks(destination);assert.deepEqual(destination,copy);
});
