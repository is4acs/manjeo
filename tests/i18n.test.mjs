import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import {
  translations, t, tEvent, formatDate, normalizeLanguage, getLanguage,
  setLanguageValue, subscribeLanguage, documentLanguage, localeTag,
} from '../lib/i18n.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const parameters = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
afterEach(() => setLanguageValue('fr'));

test('every dictionary preserves all named parameters in Haitian Creole and Brazilian Portuguese', async () => {
  const directory = path.join(root, 'lib/locales');
  for (const filename of readdirSync(directory).filter(name => name.endsWith('.ts'))) {
    const module = await import(pathToFileURL(path.join(directory, filename)).href);
    for (const [name, entries] of Object.entries(module).filter(([name]) => name.endsWith('Translations'))) {
      for (const [source, targets] of Object.entries(entries)) {
        assert.equal(targets.length, 2, `${filename}: ${source}`);
        for (const target of targets) {
          assert.ok(typeof target === 'string' && target.trim(), `${name}: empty translation for ${source}`);
          assert.deepEqual(parameters(target), parameters(source), `${filename}: changed parameters in ${source}`);
        }
      }
    }
  }
});

function sourceFiles(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.tsx?$/.test(entry.name) ? [filename] : [];
  });
}

function literalAlternatives(node) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node];
  if (ts.isConditionalExpression(node)) return [...literalAlternatives(node.whenTrue), ...literalAlternatives(node.whenFalse)];
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return [...literalAlternatives(node.left), ...literalAlternatives(node.right)];
  if (ts.isParenthesizedExpression(node)) return literalAlternatives(node.expression);
  return [];
}

test('literal interface keys, including conditional labels, have both translations across all screens', () => {
  const files = [...sourceFiles(path.join(root, 'app')), ...sourceFiles(path.join(root, 'components')), ...sourceFiles(path.join(root, 'lib'))]
    .filter(filename => !filename.includes(`${path.sep}locales${path.sep}`));
  const missing = [];
  let checked = 0;
  for (const filename of files) {
    const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
        for (const literal of literalAlternatives(node.arguments[0])) {
          if (!literal.text) continue;
          checked++;
          if (!Object.hasOwn(translations, literal.text)) missing.push(`${path.relative(root, filename)}:${source.getLineAndCharacterOfPosition(literal.getStart(source)).line + 1} ${literal.text}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.ok(checked > 100, 'The check must cover the actual interface, not an empty fixture');
  assert.deepEqual(missing, []);
});

test('French, Haitian Creole and Brazilian Portuguese update without changing stored source text', () => {
  const sourceNotice = 'Informations du restaurant enregistrées.';
  for (const [language, close, documentTag] of [['fr', 'Fermer', 'fr'], ['ht', 'Fèmen', 'ht'], ['pt', 'Fechar', 'pt-BR']]) {
    setLanguageValue(language);
    assert.equal(getLanguage(), language);
    assert.equal(t('Fermer'), close);
    assert.equal(documentLanguage(), documentTag);
    assert.equal(t(sourceNotice), language === 'fr' ? sourceNotice : translations[sourceNotice][language === 'ht' ? 0 : 1]);
  }
  assert.equal(sourceNotice, 'Informations du restaurant enregistrées.');
  assert.equal(normalizeLanguage('pt-BR'), 'pt');
  assert.equal(normalizeLanguage('HT-ht'), 'ht');
  assert.equal(normalizeLanguage('fr-FR'), 'fr');
  for (const unsupported of ['gcr', 'en', '', null, {}]) assert.equal(normalizeLanguage(unsupported), null);
  assert.equal(localeTag('pt'), 'pt-BR');
});

test('language subscriptions update mounted interfaces and can be detached', () => {
  const received = [];
  const unsubscribe = subscribeLanguage(() => received.push(getLanguage()));
  setLanguageValue('ht');
  setLanguageValue('ht');
  setLanguageValue('pt');
  unsubscribe();
  setLanguageValue('fr');
  assert.deepEqual(received, ['ht', 'pt']);
});

test('Haitian dates use Haitian month and weekday names with the Cayenne calendar day', () => {
  setLanguageValue('ht');
  const date = formatDate('2026-01-15T02:30:00Z', {weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'});
  assert.match(date, /mèkredi/);
  assert.match(date, /14/);
  assert.match(date, /janvye/);
  assert.match(date, /23:30/);
  assert.doesNotMatch(date, /mercredi|janvier|Thursday/);
  assert.equal(formatDate('invalid date'), t('Horaire indisponible'));
  setLanguageValue('pt');
  assert.match(formatDate('2026-01-15T02:30:00Z', {month: 'long'}), /janeiro/);
});

test('system history translates its labels and preserves courier names and free-form reasons verbatim', () => {
  const name = 'Anaïs « Fermer »';
  const reason = 'Mwen bloke — panne {status} / rua 7';
  const events = [
    `Annulation — ${reason}`,
    `Mission confiée à ${name} — ${reason}`,
    `Mission libérée par ${name} — ${reason}`,
    `Mission libérée — ${reason}`,
  ];
  for (const language of ['ht', 'pt']) {
    setLanguageValue(language);
    for (const source of events) {
      const rendered = tEvent(source);
      assert.notEqual(rendered, source, `System label not translated in ${language}: ${source}`);
      assert.ok(rendered.includes(reason), rendered);
      if (source.includes(name)) assert.ok(rendered.includes(name), rendered);
    }
  }
});

test('interface interpolation never translates or mutates supplied names, addresses or notes', () => {
  const authorData = Object.freeze({name: 'Fermer', note: 'Bonjour — {count} — eu cheguei', address: '7 bis rue Lallouette'});
  const snapshot = JSON.stringify(authorData);
  for (const language of ['fr', 'ht', 'pt']) {
    setLanguageValue(language);
    assert.ok(t('Livreur : {name}', authorData).endsWith('Fermer'));
    assert.ok(t('Note du client : {note}', authorData).endsWith(authorData.note));
    assert.equal(JSON.stringify(authorData), snapshot);
  }
});

test('unknown labels matching Object prototype properties remain plain text', () => {
  for (const language of ['fr','ht','pt']) {
    setLanguageValue(language);
    for (const label of ['constructor','toString','__proto__']) assert.equal(t(label),label);
  }
});
