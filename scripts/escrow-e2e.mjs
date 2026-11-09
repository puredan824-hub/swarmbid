// WO-001 acceptance: deploy escrow contract to escrow subaccount and run
// deposit->release and deposit->refund paths + error paths on testnet.
// Usage: node scripts/escrow-e2e.mjs <path-to-escrow.wasm>
// Keys loaded from .near-testnet-keys/ (0600), never printed.
import { Account, JsonRpcProvider, KeyPairSigner } from 'near-api-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const keyDir = path.join(root, '.near-testnet-keys');
const wasmPath = process.argv[2];
if (!wasmPath) { console.error('usage: node scripts/escrow-e2e.mjs <wasm>'); process.exit(2); }

const MASTER = 'garnett-swarmbid.testnet';
const ESCROW = `escrow.${MASTER}`;
const BUYER = `buyer.${MASTER}`;
const WRITER = `writer.${MASTER}`;
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });

function acct(id) {
  const saved = JSON.parse(fs.readFileSync(path.join(keyDir, id + '.json'), 'utf8'));
  return new Account(id, provider, KeyPairSigner.fromSecretKey(saved.private_key));
}
const escrow = acct(ESCROW), buyer = acct(BUYER), writer = acct(WRITER);
const txHashOf = (o) => o?.transaction?.hash || o?.transaction_outcome?.id || o?.txHash || 'unknown';
let keysDumped = false;
const dumpKeys = (o) => { if (!keysDumped) { keysDumped = true; say(`callFunction return keys=${Object.keys(o || {})}`); } };
const yocto = (n) => BigInt(Math.round(n * 1e24)).toString(); // test amounts only (0.1 NEAR scale, exact enough for balance delta check)
const bal = async (a) => BigInt((await provider.viewAccount({ accountId: a.accountId })).amount);
const GAS = '300000000000000';
const log = [];
const say = (s) => { console.log(s); log.push(s); };

// 1. deploy
const wasm = fs.readFileSync(wasmPath);
say(`WASM bytes=${wasm.length}`);
const dep = await escrow.deployContract(wasm);
say(`DEPLOY tx=${txHashOf(dep)} status=${JSON.stringify(dep.status)}`);

// helper: view get_job
async function getJob(jobId) {
  const r = await provider.callFunctionRaw({ contractId: ESCROW, method: 'get_job', args: { job_id: jobId } });
  return r;
}
// helper: capture failing call
async function expectFail(label, promise) {
  try {
    const o = await promise;
    say(`${label}: UNEXPECTED SUCCESS tx=${o?.transaction?.hash}`);
    return { ok: false, hash: o?.transaction?.hash };
  } catch (e) {
    const msg = (e?.message || String(e)).slice(0, 300);
    let hash = e?.txHash || e?.transaction?.hash || e?.context?.transactionHash || null;
    say(`${label}: FAILED as expected hash=${hash} err=${msg}`);
    return { ok: true, hash };
  }
}

const run = Date.now().toString(36);
const jobA = `e2e-a-${run}`, jobB = `e2e-b-${run}`, jobC = `e2e-c-${run}`;

// 2. Path A: create_job (deposit 0.1) -> get_job -> release -> writer +0.1
const wBefore = await bal(writer);
const cA = await buyer.callFunctionRaw({ contractId: ESCROW, methodName: 'create_job', args: { job_id: jobA, worker: WRITER }, deposit: yocto(0.1), gas: GAS });
say(`A create_job tx=${txHashOf(cA)}`);
say(`A get_job=${JSON.stringify(await getJob(jobA))}`);
const rA = await buyer.callFunctionRaw({ contractId: ESCROW, methodName: 'release', args: { job_id: jobA } });
say(`A release tx=${txHashOf(rA)}`);
const wAfter = await bal(writer);
say(`A writer delta yocto=${(wAfter - wBefore).toString()} (expect 100000000000000000000000)`);
say(`A get_job after=${JSON.stringify(await getJob(jobA))}`);

// 3. Path B: create_job -> refund -> buyer gets it back (minus gas)
const bBefore = await bal(buyer);
const cB = await buyer.callFunctionRaw({ contractId: ESCROW, methodName: 'create_job', args: { job_id: jobB, worker: WRITER }, deposit: yocto(0.1), gas: GAS });
say(`B create_job tx=${txHashOf(cB)}`);
const rB = await buyer.callFunctionRaw({ contractId: ESCROW, methodName: 'refund', args: { job_id: jobB } });
say(`B refund tx=${txHashOf(rB)}`);
const bAfter = await bal(buyer);
say(`B buyer net delta yocto=${(bAfter - bBefore).toString()} (expect small negative = gas only, > -0.01 NEAR)`);
say(`B get_job after=${JSON.stringify(await getJob(jobB))}`);

// 4. Error paths: fund jobC, then non-buyer release must fail; duplicate create_job must fail
const cC = await buyer.callFunctionRaw({ contractId: ESCROW, methodName: 'create_job', args: { job_id: jobC, worker: WRITER }, deposit: yocto(0.05), gas: GAS });
say(`C create_job tx=${txHashOf(cC)}`);
await expectFail('C non-buyer release', writer.callFunctionRaw({ contractId: ESCROW, methodName: 'release', args: { job_id: jobC } }));
await expectFail('C duplicate create_job', buyer.callFunctionRaw({ contractId: ESCROW, methodName: 'create_job', args: { job_id: jobC, worker: WRITER }, deposit: yocto(0.05), gas: GAS }));
// cleanup: refund jobC back to buyer
const rC = await buyer.callFunctionRaw({ contractId: ESCROW, methodName: 'refund', args: { job_id: jobC } });
say(`C cleanup refund tx=${txHashOf(rC)}`);

fs.writeFileSync(path.join(root, 'escrow-e2e-result.json'), JSON.stringify({ wasm: wasmPath, lines: log }, null, 2));
say('E2E_DONE');
