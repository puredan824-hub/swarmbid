import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { Board, assertTransition, yocto } from './board.js';
import { checkAcceptance, sha256 } from './acceptance.js';
import type { EscrowChain, Receipt, TaskInput, TaskState } from './types.js';

const testRoot = join(dirname(fileURLToPath(import.meta.url)), '.test-tmp');
mkdirSync(testRoot, { recursive: true });
const input: TaskInput = { id: 'job-1', buyerAccount: 'buyer.testnet', title: 'Report',
  budgetYocto: '1000', spec: { minWords: 6, requiredSections: ['Overview', 'Conclusion'],
    keywords: ['swarm', 'near'] } };
const good = '# Overview\nSWARM works on NEAR.\n## Conclusion\nAll done.\n';

class FakeChain implements EscrowChain {
  calls: string[][] = [];
  fail = false;
  async createJob(...args: [string, string, string, string]): Promise<{ txHash: string }> {
    this.calls.push(['createJob', ...args]);
    if (this.fail) throw new Error('Chain unavailable');
    return { txHash: 'create-hash' };
  }
  async release(...args: [string, string]): Promise<{ txHash: string }> {
    this.calls.push(['release', ...args]);
    if (this.fail) throw new Error('Chain unavailable');
    return { txHash: 'release-hash' };
  }
  async refund(...args: [string, string]): Promise<{ txHash: string }> {
    this.calls.push(['refund', ...args]);
    if (this.fail) throw new Error('Chain unavailable');
    return { txHash: 'refund-hash' };
  }
}

function fixture(t: TestContext, override: Partial<TaskInput> = {}) {
  const directory = mkdtempSync(join(testRoot, 'board-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const chain = new FakeChain();
  const receiptPath = join(directory, 'receipts.jsonl');
  const board = new Board({ ...input, ...override }, chain, receiptPath);
  const bid = (priceYocto: string, workerAccount = 'worker.testnet') => board.addBid({
    workerAccount, priceYocto, etaMinutes: 10, reason: 'Can deliver' });
  const submit = (content = good, expected = sha256(content)) => {
    const path = join(directory, 'report.md');
    writeFileSync(path, content);
    board.submitDeliverable({ path, sha256: expected });
  };
  const receipts = (): Receipt[] => readFileSync(receiptPath, 'utf8').trim().split('\n')
    .map((line: string) => JSON.parse(line) as Receipt);
  return { board, chain, bid, submit, receipts, receiptPath, directory };
}

test('one counteroffer, award, acceptance and Released JSONL receipt', async t => {
  const { board, chain, bid, submit, receipts } = fixture(t);
  board.startBidding();
  bid('950', 'expensive.testnet');
  const lowest = bid('900');
  const counter = board.closeBidding('Use planned price');
  assert.deepEqual(counter, { bidId: lowest.id, workerAccount: lowest.workerAccount,
    counterPriceYocto: '800', reason: 'Use planned price', round: 2 });
  assert.throws(() => board.closeBidding());
  assert.throws(() => bid('700'));
  board.respondToCounter(true);
  assert.equal(board.task.state, 'Awarded');
  const winner = board.task.bids.find(b => b.id === board.task.chosenBidId)!;
  assert.equal(winner.round, 2);
  assert.equal(winner.priceYocto, '800');
  assert.throws(() => board.respondToCounter(true));
  await board.fund('buyer-key');
  submit();
  assert.equal(board.inspectDeliverable().pass, true);
  assert.equal(board.task.state, 'Accepted');
  const receipt = await board.release('buyer-key');
  assert.equal(board.task.state, 'Released');
  assert.equal(receipt.receiptId, board.task.receiptId);
  assert.match(receipt.receiptId, /^[a-f\d-]{36}$/);
  assert.equal(Number.isNaN(Date.parse(receipt.timestamp)), false);
  assert.equal(receipt.worker, 'worker.testnet');
  assert.equal(receipt.buyer, input.buyerAccount);
  assert.equal(receipt.amountYocto, '800');
  assert.equal(receipt.result, 'Released');
  assert.equal(receipt.checksSummary?.pass, true);
  assert.deepEqual(receipt.txHashes, { createJob: 'create-hash', release: 'release-hash' });
  assert.deepEqual(receipt.explorerLinks, ['https://testnet.nearblocks.io/txns/create-hash',
    'https://testnet.nearblocks.io/txns/release-hash']);
  assert.deepEqual(receipts(), [receipt]);
  assert.deepEqual(chain.calls, [['createJob', 'job-1', 'worker.testnet', '800', 'buyer-key'],
    ['release', 'job-1', 'buyer-key']]);
  await assert.rejects(board.release('buyer-key'));
  assert.equal(receipts().length, 1);
});

test('failed acceptance follows Funded -> Refunded with receipt', async t => {
  const { board, chain, bid, submit, receipts } = fixture(t);
  board.startBidding(); bid('700'); board.closeBidding();
  await board.fund('key');
  await assert.rejects(board.refund('key'));
  submit('Too short');
  const checks = board.inspectDeliverable();
  assert.equal(checks.pass, false);
  assert.equal(board.task.state, 'Funded');
  await assert.rejects(board.release('key'));
  const receipt = await board.refund('key');
  assert.equal(board.task.state, 'Refunded');
  assert.equal(receipt.result, 'Refunded');
  assert.deepEqual(receipt.checksSummary, checks);
  assert.deepEqual(receipt.txHashes, { createJob: 'create-hash', refund: 'refund-hash' });
  assert.deepEqual(receipts(), [receipt]);
  assert.equal(chain.calls.at(-1)?.[0], 'refund');
});

test('all offers over budget and rejected counter cancel without chain calls', t => {
  const { board, chain, bid, receipts } = fixture(t);
  board.startBidding(); bid('1001'); bid('2000');
  assert.equal(board.closeBidding()?.counterPriceYocto, '800');
  board.respondToCounter(false);
  assert.equal(board.task.state, 'Cancelled');
  assert.equal(receipts()[0].result, 'Cancelled');
  assert.equal(receipts()[0].worker, null);
  assert.equal(receipts()[0].amountYocto, '0');
  assert.deepEqual(receipts()[0].txHashes, {});
  assert.deepEqual(chain.calls, []);
});

test('rejection chooses next cheapest original bid without another counter', t => {
  const { board, bid } = fixture(t);
  board.startBidding(); bid('900');
  const next = bid('950', 'next.testnet'); bid('975');
  board.closeBidding(); board.respondToCounter(false);
  assert.equal(board.task.chosenBidId, next.id);
  assert.equal(board.task.bids.filter(b => b.round === 2).length, 0);
  assert.equal(board.pendingCounter, undefined);
});

test('empty bidding, lone rejected offer and Open cancellation create receipts', t => {
  const empty = fixture(t); empty.board.startBidding(); empty.board.closeBidding();
  assert.equal(empty.receipts()[0].result, 'Cancelled');
  const lone = fixture(t); lone.board.startBidding(); lone.bid('900');
  lone.board.closeBidding(); lone.board.respondToCounter(false);
  assert.equal(lone.receipts()[0].result, 'Cancelled');
  const open = fixture(t); open.board.cancel();
  assert.equal(open.receipts()[0].result, 'Cancelled');
  assert.throws(() => open.board.cancel());
});

test('exact allowed edge set and illegal public operations', async t => {
  const allowed: Record<TaskState, TaskState[]> = {
    Open: ['Bidding', 'Cancelled'], Bidding: ['Negotiating', 'Cancelled'],
    Negotiating: ['Awarded'], Awarded: ['Funded'], Funded: ['Delivered', 'Refunded'],
    Delivered: ['Accepted'], Accepted: ['Released'], Released: [], Refunded: [], Cancelled: [],
  };
  for (const from of Object.keys(allowed) as TaskState[]) {
    for (const to of Object.keys(allowed) as TaskState[]) {
      if (allowed[from].includes(to)) assert.doesNotThrow(() => assertTransition(from, to));
      else assert.throws(() => assertTransition(from, to), /Illegal transition/);
    }
  }
  const { board, bid } = fixture(t);
  assert.throws(() => bid('1'));
  assert.throws(() => board.inspectDeliverable());
  await assert.rejects(board.fund('key'));
  board.startBidding(); bid('800'); board.closeBidding();
  assert.throws(() => board.cancel());
  await assert.rejects(board.release('key'));
});

test('BigInt price sorting, fractional NEAR arithmetic and floor rounding', t => {
  // Exact yocto equivalents of 0.1 + 0.2 NEAR, without floating point.
  const tenth = 100000000000000000000000n;
  assert.equal(yocto(tenth.toString()) + yocto((2n * tenth).toString()), 3n * tenth);
  const { board, bid } = fixture(t, { budgetYocto: (3n * tenth).toString() });
  assert.equal(board.plannedPriceYocto, '240000000000000000000000');
  board.startBidding();
  bid('240000000000000000000001');
  const exact = bid('240000000000000000000000');
  assert.equal(board.closeBidding(), undefined);
  assert.equal(board.task.chosenBidId, exact.id);
  const odd = fixture(t, { budgetYocto: '1001' });
  assert.equal(odd.board.plannedPriceYocto, '800');
  for (const bad of ['0.1', '-1', '1e24', '', ' 1', 'NaN']) assert.throws(() => yocto(bad));
});

test('acceptance checks headings, mixed tokens, keywords and optional raw-byte hash', () => {
  const spec = { minWords: 3, requiredSections: ['Overview'], keywords: ['NEAR'] };
  const text = '# Overview\n\u4e2d\u6587 near';
  const result = checkAcceptance(text, spec, sha256(text));
  assert.equal(result.pass, true);
  assert.match(result.checks[0].detail, /Measured 4 words/);
  assert.equal(checkAcceptance(text, spec).checks.some(c => c.name === 'sha256'), false);
  assert.equal(checkAcceptance(text, spec, '0'.repeat(64)).pass, false);
  assert.equal(checkAcceptance('Some Overview prose with near', spec).pass, false);
  assert.equal(checkAcceptance('', spec).pass, false);
  assert.equal(checkAcceptance('Overview extra\nnear words', spec).pass, false);
  const bytes = Buffer.from([0xff, 0x20, 0x61]);
  assert.equal(checkAcceptance(bytes, { minWords: 0, requiredSections: [], keywords: [] }, sha256(bytes)).pass, true);
});

test('registered hash catches modified file and receipts escape non-ASCII', async t => {
  const { board, bid, submit, receiptPath } = fixture(t, {
    spec: { minWords: 1, requiredSections: ['\u4e2d\u6587'], keywords: [] },
  });
  board.startBidding(); bid('800'); board.closeBidding(); await board.fund('key');
  submit('# \u4e2d\u6587', sha256('original'));
  assert.equal(board.inspectDeliverable().pass, false);
  await board.refund('key');
  assert.match(readFileSync(receiptPath, 'utf8'), /^[\x00-\x7f]*$/);
});

test('chain failures preserve state and overlapping operations cannot double-fund', async t => {
  const { board, chain, bid, submit } = fixture(t);
  board.startBidding(); bid('800'); board.closeBidding(); chain.fail = true;
  await assert.rejects(board.fund('key'), /Chain unavailable/);
  assert.equal(board.task.state, 'Awarded');
  chain.fail = false;
  const funding = board.fund('key');
  await assert.rejects(board.fund('key'), /already in progress/);
  await funding;
  submit(); board.inspectDeliverable(); chain.fail = true;
  await assert.rejects(board.release('key'));
  assert.equal(board.task.state, 'Accepted');
  chain.fail = false; await board.release('key');
});

test('receipt append failure can retry settlement without repeating chain call', async t => {
  const { board, chain, bid, submit, receiptPath } = fixture(t);
  board.startBidding(); bid('800'); board.closeBidding(); await board.fund('key');
  submit(); board.inspectDeliverable();
  mkdirSync(receiptPath);
  await assert.rejects(board.release('key'));
  assert.equal(board.task.state, 'Accepted');
  rmSync(receiptPath, { recursive: true });
  await board.release('key');
  assert.equal(chain.calls.filter(call => call[0] === 'release').length, 1);
});

test('task snapshots cannot bypass rules and receipt file appends multiple tasks', t => {
  const { board, chain, receiptPath, receipts } = fixture(t);
  const snapshot = board.task;
  snapshot.state = 'Released'; snapshot.spec.minWords = 0;
  assert.equal(board.task.state, 'Open');
  assert.equal(board.task.spec.minWords, 6);
  board.cancel();
  const second = new Board({ ...input, id: 'job-2' }, chain, receiptPath);
  second.cancel();
  assert.deepEqual(receipts().map(r => r.taskId), ['job-1', 'job-2']);
});

test('refund receipt retry cannot switch to acceptance after refund has been sent', async t => {
  const { board, chain, bid, submit, receiptPath, directory } = fixture(t);
  board.startBidding(); bid('800'); board.closeBidding(); await board.fund('key');
  submit('bad'); board.inspectDeliverable();
  mkdirSync(receiptPath);
  await assert.rejects(board.refund('key'));
  assert.equal(board.task.state, 'Funded');
  writeFileSync(join(directory, 'report.md'), good);
  assert.throws(() => board.inspectDeliverable(), /Refund already submitted/);
  assert.throws(() => submit(), /Refund already submitted/);
  rmSync(receiptPath, { recursive: true });
  await board.refund('key');
  assert.equal(board.task.state, 'Refunded');
  assert.equal(chain.calls.filter(call => call[0] === 'refund').length, 1);
});
