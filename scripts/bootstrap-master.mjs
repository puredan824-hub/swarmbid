// Bootstrap: create the master testnet account via the official testnet helper,
// which creates the account and funds it from the faucet side. Key saved locally 0600.
import { KeyPair } from 'near-api-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const keyDir = path.join(root, '.near-testnet-keys');
fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });

const MASTER_ID = process.env.MASTER_ID || 'garnett-swarmbid.testnet';
const keyFile = path.join(keyDir, MASTER_ID + '.json');

let keyPair;
if (fs.existsSync(keyFile)) {
  const saved = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  keyPair = KeyPair.fromString(saved.private_key);
  console.log('key exists for', MASTER_ID);
} else {
  keyPair = KeyPair.fromRandom('ed25519');
  fs.writeFileSync(keyFile, JSON.stringify({
    account_id: MASTER_ID,
    public_key: keyPair.getPublicKey().toString(),
    private_key: keyPair.toString(),
  }, null, 2), { mode: 0o600 });
  console.log('key generated for', MASTER_ID);
}

const publicKey = keyPair.getPublicKey().toString();
const res = await fetch('https://helper.testnet.near.org/account', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ newAccountId: MASTER_ID, newAccountPublicKey: publicKey }),
});
const text = await res.text();
console.log('helper status:', res.status);
console.log('helper body:', text.slice(0, 800));
