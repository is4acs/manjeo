import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { t } from '../lib/i18n.ts';

const source = readFileSync(new URL('../app/validation.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;

function validation() {
  let language = 'ht';
  const fields = [];
  // Model only the DOM contract used by the handlers. Native validity flags
  // are independent of the custom message, as they are in an actual form.
  class Input {
    constructor(validity = {}, attributes = {}) {
      this.validity = {customError: false, ...validity};
      this.validationMessage = '';
      this.value = '';
      Object.assign(this, attributes);
      fields.push(this);
    }
    setCustomValidity(message) {
      this.validationMessage = message;
      this.validity.customError = !!message;
    }
  }
  class Select extends Input {}
  class Textarea extends Input {}
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    require: name => {
      assert.equal(name, '@/lib/i18n');
      return {t: (source, params) => t(source, params, language)};
    },
    HTMLInputElement: Input, HTMLSelectElement: Select, HTMLTextAreaElement: Textarea,
    document: {querySelectorAll: selector => { assert.equal(selector, 'input,select,textarea'); return fields; }},
  });
  return {...exports, Input, Select, Textarea, changeLanguage: value => { language = value; }};
}

test('required inputs, selects and textareas explain the error in the selected language', () => {
  const form = validation();
  for (const Type of [form.Input, form.Select, form.Textarea]) {
    const input = new Type({valueMissing: true});
    form.localizeInvalid({target: input});
    assert.equal(input.validationMessage, 'Chan sa a obligatwa.');
  }
});

test('an email format error stays specific when an invalid event fires again', () => {
  const form = validation();
  const email = new form.Input({typeMismatch: true}, {type: 'email', value: 'adresse-incomplete'});
  form.localizeInvalid({target: email});
  assert.equal(email.validationMessage, 'Antre yon adrès imel ki valid.');
  form.changeLanguage('pt');
  form.localizeInvalid({target: email});
  assert.equal(email.validationMessage, 'Digite um e-mail válido.');
  assert.equal(email.value, 'adresse-incomplete');
});

test('minimum length and numeric min/max retain their parameters across a language change', () => {
  const form = validation();
  const cases = [
    [new form.Input({tooShort: true}, {minLength: 5, value: 'abc'}), 'Antre omwen 5 karaktè.', 'Digite pelo menos 5 caracteres.'],
    [new form.Input({rangeUnderflow: true}, {min: '0', value: '-1'}), 'Valè minimòm nan se 0.', 'O valor mínimo é 0.'],
    [new form.Input({rangeOverflow: true}, {max: '20', value: '21'}), 'Valè maksimòm nan se 20.', 'O valor máximo é 20.'],
  ];
  for (const [input, expected] of cases) {
    form.localizeInvalid({target: input});
    assert.equal(input.validationMessage, expected);
  }
  form.changeLanguage('pt');
  form.refreshValidationLanguage();
  for (const [input, , expected] of cases) assert.equal(input.validationMessage, expected);
  assert.deepEqual(cases.map(([input]) => input.value), ['abc', '-1', '21']);
});

test('a custom phone error changes from Haitian Creole to Portuguese without editing the field', () => {
  const form = validation();
  const phone = new form.Input({}, {type: 'tel', value: '123'});
  form.setFieldValidity(phone, 'Saisissez un numéro de téléphone valide, par exemple 0694 00 00 00.');
  assert.equal(phone.validationMessage, 'Antre yon nimewo telefòn ki valab, pa egzanp 0694 00 00 00.');
  form.changeLanguage('pt');
  form.refreshValidationLanguage();
  assert.equal(phone.validationMessage, 'Digite um telefone válido, por exemplo 0694 00 00 00.');
  assert.equal(phone.value, '123');
  assert.equal(phone.validity.customError, true);
});

test('typing clears both the visible error and the saved translation', () => {
  const form = validation();
  const input = new form.Input();
  form.setFieldValidity(input, 'Ce champ est requis.');
  form.clearValidity({target: input});
  assert.equal(input.validationMessage, '');
  assert.equal(input.validity.customError, false);
  form.changeLanguage('pt');
  form.refreshValidationLanguage();
  assert.equal(input.validationMessage, '');
  // An unrelated validator must not be overwritten by the cleared error.
  input.setCustomValidity('Unrelated validation message');
  form.refreshValidationLanguage();
  assert.equal(input.validationMessage, 'Unrelated validation message');
});

test('untracked custom errors and unrelated event targets are left alone', () => {
  const form = validation();
  const foreign = new form.Input();
  foreign.setCustomValidity('Preserve this validator message');
  form.localizeInvalid({target: foreign});
  form.changeLanguage('pt');
  form.refreshValidationLanguage();
  assert.equal(foreign.validationMessage, 'Preserve this validator message');
  assert.doesNotThrow(() => form.localizeInvalid({target: {}}));
  assert.doesNotThrow(() => form.clearValidity({target: {}}));
});

test('other native invalid states receive a translated fallback', () => {
  const form = validation();
  for (const state of [{patternMismatch: true}, {stepMismatch: true}, {tooLong: true}]) {
    const input = new form.Input(state);
    form.localizeInvalid({target: input});
    assert.equal(input.validationMessage, 'Verifye valè ou antre a.');
  }
});
