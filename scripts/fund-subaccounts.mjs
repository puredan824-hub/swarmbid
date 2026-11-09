// Top-up: v7 createSubAccount's nearToTransfer was interpreted in yocto, so the
// sub-accounts were created but effectively unfunded (1-2 yocto). Transfer real
// NEAR amounts from master now. Amounts passed as yocto BigInt via parseNearAmount.
import { Account, JsonRpcProvider, KeyPairSigner, parseNearAmount } from 'near-api-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const keyDir = path.join(root, '.near-testnet-keys');
const MASTER_ID = 'garnett-swarmbid.testnet';
const TOPUPS = {
  'buyer.garnett-swarmbid.testnet': '1',
  'researcher.garnett-swarmbid.testnet': '1',
  'writer.garnett-swarmbid.testnet': '1',
  'reviewer.garnett-swarmbid.testnet': '1',
  'escrow.garnett-swarmbid.testnet': '2',
};

const masterSaved = JSON.parse(fs.readFileSync(path.join(keyDir, MASTER_ID + '.json'), 'utf8'));
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const master = new Account(MASTER_ID, provider, KeyPairSigner.fromSecretKey(masterSaved.private_key));

for (const [receiverId, nearAmt] of Object.entries(TOPUPS)) {
  const outcome = await master.transfer({ receiverId, amount: BigInt(parseNearAmount(nearAmt)) });
  const txHash = outcome?.transaction?.hash || 'unknown';
  const bal = await provider.viewAccount({ accountId: receiverId });
  console.log(`TOPUP ${receiverId} +${nearAmt} NEAR tx=${txHash} balance_yocto=${bal.amount.toString()}`);
}
const m = await provider.viewAccount({ accountId: MASTER_ID });
console.log(`MASTER balance_yocto=${m.amount.toString()}`);
