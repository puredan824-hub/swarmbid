// Top up escrow account from master for contract storage staking.
import { Account, JsonRpcProvider, KeyPairSigner } from 'near-api-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const keyDir = path.join(root, '.near-testnet-keys');
const MASTER = 'garnett-swarmbid.testnet';
const ESCROW = `escrow.${MASTER}`;
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const saved = JSON.parse(fs.readFileSync(path.join(keyDir, MASTER + '.json'), 'utf8'));
const master = new Account(MASTER, provider, KeyPairSigner.fromSecretKey(saved.private_key));
const amount = process.argv[2] || '3.6';
const out = await master.transfer({ receiverId: ESCROW, amount: BigInt(Math.round(parseFloat(amount) * 1e24)).toString() });
console.log(`TOPUP ${amount} NEAR master->escrow tx=${out.transaction.hash}`);
const bal = await provider.viewAccount({ accountId: ESCROW });
console.log(`ESCROW balance yocto=${bal.amount} storage_usage=${bal.storage_usage}`);
const mbal = await provider.viewAccount({ accountId: MASTER });
console.log(`MASTER balance yocto=${mbal.amount}`);
