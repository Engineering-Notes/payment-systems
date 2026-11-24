import assert from 'node:assert/strict';
import { normalisePhone } from './daraja-client.mjs';

for (const [input, want] of [['0712345678', '254712345678'], ['+254 712 345 678', '254712345678'],
  ['712345678', '254712345678'], ['0110123456', '254110123456'], ['254712345678', '254712345678']]) {
  assert.equal(normalisePhone(input), want);
}
for (const bad of ['0812345678', '07123', '+1 415 555 0100']) assert.throws(() => normalisePhone(bad));

// The STK password is base64, not encryption: anyone holding a request body can recover the passkey.
const pw = Buffer.from('174379' + 'my-secret-passkey' + '20261210170000').toString('base64');
assert.equal(Buffer.from(pw, 'base64').toString().slice(6, -14), 'my-secret-passkey');
console.log('unit: phone normalisation and password checks passed');
