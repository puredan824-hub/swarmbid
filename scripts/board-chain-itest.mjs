// Integration test: WO-002 Board state machine <-> WO-001 escrow contract (testnet, real txs).
// Path 1: bids -> counter -> accept -> fund (on-chain) -> deliver -> pass -> release -> receipt.
// Path 2: bid -> award -> fund -> deliver (bad) -> fail -> refund -> receipt.
import { Board } from '../src/board/dist/board.js';
import { createEscrowChain, getJob } from '../src/chain/dist/escrow.js';
import { Account, JsonRpcProvider, KeyPairSigner } from 'near-api-js';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const MASTER = 'garnett-swarmbid.testnet';
const BUYER = `buyer.${MASTER}`;
const RESEARCHER = `researcher.${MASTER}`;
const WRITER = `writer.${MASTER}`;
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const bal = async (id) => BigInt((await provider.viewAccount({ accountId: id })).amount);
const chain = createEscrowChain();
const stamp = Date.now().toString(36);
const receiptsPath = path.join(root, `itest-receipts-${stamp}.jsonl`);
const log = [];
const say = (s) => { console.log(s); log.push(s); };
const N = (x) => (BigInt(x) * 10n ** 24n).toString(); // whole NEAR -> yocto (exact)
const frac = (num, den) => (BigInt(num) * 10n ** 24n / BigInt(den)).toString();

// ---------- Path 1: counter + release ----------
const t1 = {
  id: `itest-${stamp}-a`, buyerAccount: BUYER, title: 'Research 5 agent marketplaces, 600-word brief',
  spec: { minWords: 60, requiredSections: ['Summary', 'Findings'], keywords: ['agent', 'escrow'] },
  budgetYocto: frac(30, 100), // 0.30 NEAR; plan price = 0.24
};
const b1 = new Board(t1, chain, receiptsPath);
b1.startBidding();
b1.addBid({ workerAccount: WRITER, priceYocto: frac(29, 100), etaMinutes: 9, reason: 'writer, fast draft' });
b1.addBid({ workerAccount: RESEARCHER, priceYocto: frac(28, 100), etaMinutes: 7, reason: 'researcher, sources ready' });
const counter = b1.closeBidding();
say(`P1 counter=${JSON.stringify(counter)}`);
if (!counter || counter.counterPriceYocto !== frac(24, 100)) throw new Error('counter mismatch');
b1.respondToCounter(true);
say(`P1 state after award=${b1.task.state} chosen price=${b1.task.bids.find(b => b.id === b1.task.chosenBidId)?.priceYocto}`);
const rBefore = await bal(RESEARCHER);
await b1.fund(BUYER);
say(`P1 funded escrowTx=${b1.task.escrowTxHash} onchain=${JSON.stringify(await getJob(t1.id))}`);
const good = ['# Summary', 'agent escrow markets let a buyer agent hire worker agents with escrow settlement on chain receipts for every task in this brief.', '# Findings', ...Array(10).fill('agent escrow bidding negotiation acceptance release refund receipt budget worker buyer findings row')].join('\n');
const goodPath = path.join(root, 'examples', `itest-deliverable-${stamp}.md`);
fs.writeFileSync(goodPath, good);
const goodSha = createHash('sha256').update(fs.readFileSync(goodPath)).digest('hex');
b1.submitDeliverable({ path: goodPath, sha256: goodSha });
const chk1 = b1.inspectDeliverable();
say(`P1 acceptance pass=${chk1.pass} checks=${chk1.checks.map(c => `${c.name}:${c.pass}`).join(',')}`);
const rcpt1 = await b1.release(BUYER);
const rAfter = await bal(RESEARCHER);
say(`P1 receipt result=${rcpt1.result} amount=${rcpt1.amountYocto} txs=${JSON.stringify(rcpt1.txHashes)}`);
say(`P1 researcher delta=${(rAfter - rBefore).toString()} expect=${frac(24, 100)}`);
say(`P1 onchain final=${JSON.stringify(await getJob(t1.id))}`);

// ---------- Path 2: failed acceptance + refund ----------
const t2 = {
  id: `itest-${stamp}-b`, buyerAccount: BUYER, title: 'Short brief',
  spec: { minWords: 60, requiredSections: ['Summary'], keywords: ['agent'] },
  budgetYocto: frac(10, 100),
};
const b2 = new Board(t2, chain, receiptsPath);
b2.startBidding();
b2.addBid({ workerAccount: WRITER, priceYocto: frac(5, 100), etaMinutes: 5, reason: 'cheap and quick' });
b2.closeBidding();
say(`P2 state after award=${b2.task.state}`);
await b2.fund(BUYER);
say(`P2 funded escrowTx=${b2.task.escrowTxHash}`);
const badPath = path.join(root, 'examples', `itest-bad-${stamp}.md`);
fs.writeFileSync(badPath, 'too short');
const badSha = createHash('sha256').update(fs.readFileSync(badPath)).digest('hex');
b2.submitDeliverable({ path: badPath, sha256: badSha });
const chk2 = b2.inspectDeliverable();
say(`P2 acceptance pass=${chk2.pass} (expect false)`);
const rcpt2 = await b2.refund(BUYER);
say(`P2 receipt result=${rcpt2.result} txs=${JSON.stringify(rcpt2.txHashes)}`);
say(`P2 onchain final=${JSON.stringify(await getJob(t2.id))}`);

say(`RECEIPTS file=${receiptsPath}`);
say('ITEST_DONE');
fs.writeFileSync(path.join(root, `itest-result-${stamp}.json`), JSON.stringify({ lines: log }, null, 2));
