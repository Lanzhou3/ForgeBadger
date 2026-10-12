import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSensitiveHeaderName,
  isSensitiveHeaderValue,
} from '../src/lib/sensitive-headers.js';

// All examples are fictional; these tests use no credentials, environment, or network.
const nameCases: ReadonlyArray<readonly [string, string, boolean]> = [
  ['authorization', 'authorization', true],
  ['mixed-case authorization', 'AuThOrIzAtIoN', true],
  ['hyphen-delimited authorization', 'X-Authorization-Example', true],
  ['underscore-delimited authorization', 'X_AUTHORIZATION_EXAMPLE', true],
  ['compact API key', 'ApiKey', true],
  ['hyphenated API key', 'X-API-Key', true],
  ['underscored API key', 'X_API_KEY', true],
  ['token at the start', 'Token-Example', true],
  ['token at the end', 'Example-Token', true],
  ['token between mixed delimiters', 'Example_TOKEN-Demo', true],
  ['secret', 'X-Secret', true],
  ['credential', 'X_Credential', true],
  ['password', 'X-Password', true],
  ['standalone key', 'KEY', true],
  ['delimited key', 'X-Key-Example', true],
  ['ordinary content type', 'Content-Type', false],
  ['ordinary accept', 'Accept', false],
  ['ordinary request identifier', 'X-Request-Id', false],
  ['ordinary underscored name', 'X_EXAMPLE_MODE', false],
  ['authorization without left boundary', 'XAuthorization', false],
  ['authorization without right boundary', 'AuthorizationExample', false],
  ['token without left boundary', 'ExampleToken', false],
  ['token without right boundary', 'Tokenized', false],
  ['key inside an ordinary word', 'X-Monkey', false],
  ['plural credentials', 'X-Credentials', false],
  ['secret without right boundary', 'X-Secretive', false],
  ['password without left boundary', 'ExamplePassword', false],
  ['API key without right boundary', 'X-Api-Keynote', false],
  ['empty name', '', false],
];

for (const [label, input, expected] of nameCases) {
  test('isSensitiveHeaderName: ' + label, () => {
    assert.equal(isSensitiveHeaderName(input), expected);
  });
}

const valueCases: ReadonlyArray<readonly [string, string, boolean]> = [
  ['Bearer with fictional text', 'Bearer fictional-example', true],
  ['mixed-case Bearer', 'bEaReR fictional-example', true],
  ['Bearer with multiple spaces', 'Bearer   fictional-example', true],
  ['Bearer with a tab', 'Bearer\tfictional-example', true],
  ['Bearer token punctuation', 'Bearer fictional.example_demo-123', true],
  ['Bearer embedded in text', 'demo: Bearer fictional-example; end', true],
  ['fictional sk prefix', 'sk-fictional-example-only', true],
  ['mixed-case sk prefix', 'SK-FICTIONAL-EXAMPLE-ONLY', true],
  ['ordinary value', 'fictional-example', false],
  ['ordinary content type', 'application/json', false],
  ['ordinary Bearer word', 'Bearer', false],
  ['Bearer without token', 'Bearer   ', false],
  ['Bearer without whitespace', 'Bearerfictional-example', false],
  ['Bearer with unsupported token start', 'Bearer @fictional-example', false],
  ['sk prefix without suffix', 'sk-', false],
  ['sk with underscore separator', 'sk_fictional_example', false],
  ['empty value', '', false],
];

for (const [label, input, expected] of valueCases) {
  test('isSensitiveHeaderValue: ' + label, () => {
    assert.equal(isSensitiveHeaderValue(input), expected);
  });
}
