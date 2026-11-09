// Create sub-accounts under the master (orchestrator) account and fund each.
// Keys: one fresh ed25519 keypair per sub-account, saved locally mode 0600. Never printed.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from 'near-api-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const keyDir = path.join(root, '.near-testnet-keys');
const MASTER_ID = 'garnett-swarmbid.testnet';

// prefix -> NEAR to transfer at creation
const SUBS = {
  buyer: '1',
  researcher: '1',
  writer: '1',
  reviewer: '1',
  escrow: '2',
};

const masterSaved = JSON.parse(fs.readFileSync(path.join(keyDir, MASTER_ID + '.json'), 'utf8'));
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const master = new Account(MASTER_ID, provider, KeyPairSigner.fromSecretKey(masterSaved.private_key));

const results = [];
for (const [prefix, amount] of Object.entries(SUBS)) {
  const subId = `${prefix}.${MASTER_ID}`;
  const keyFile = path.join(keyDir, subId + '.json');
  const state = await provider.viewAccount({ accountId: subId }).catch(() => null);
  if (state) {
    console.log(`EXISTS ${subId}`);
    results.push({ id: subId, status: 'already-exists' });
    continue;
  }
  let keyPair;
  if (fs.existsSync(keyFile)) {
    keyPair = KeyPair.fromString(JSON.parse(fs.readFileSync(keyFile, 'utf8')).private_key);
  } else {
    keyPair = KeyPair.fromRandom('ed25519');
    fs.writeFileSync(keyFile, JSON.stringify({
      account_id: subId,
      public_key: keyPair.getPublicKey().toString(),
      private_key: keyPair.toString(),
    }, null, 2), { mode: 0o600 });
  }
  const outcome = await master.createSubAccount({
    accountOrPrefix: prefix,
    publicKey: keyPair.getPublicKey(),
    nearToTransfer: amount,
  });
  const txHash = outcome?.transaction?.hash || 'unknown';
  const bal = await provider.viewAccount({ accountId: subId });
  console.log(`CREATED ${subId} funded=${amount} NEAR tx=${txHash} balance_yocto=${bal.amount}`);
  results.push({ id: subId, status: 'created', funded: amount, tx: txHash, balance: bal.amount });
}

const masterBal = await master.getBalance();
console.log('MASTER_BALANCE', JSON.stringify(masterBal));
fs.writeFileSync(path.join(root, 'accounts-created.json'), JSON.stringify(results, null, 2));
