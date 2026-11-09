import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Board } from '../board/board.js';
import type { EscrowChain, Receipt, Task, CounterOffer } from '../board/types.js';
import { BUYER_ACCOUNT, RESEARCHER_ACCOUNT, WRITER_ACCOUNT, REVIEWER_ACCOUNT } from '../chain/accounts.js';
import { research, quoteResearcher, acceptsResearcherCounter } from '../workers/researcher.js';
import type { ResearchTask, ResearcherPricing } from '../workers/researcher.js';
import { writeBriefing, quoteWriter, acceptsWriterCounter } from '../workers/writer.js';
import type { WriterPricing } from '../workers/writer.js';
import { review, quoteReviewer, acceptsReviewerCounter } from '../workers/reviewer.js';
import type { ReviewerPricing } from '../workers/reviewer.js';

export function ascii(value: string): string {
  return value.replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export function saveJson(path: string, data: unknown): void {
  writeFileSync(path, ascii(JSON.stringify(data, null, 2)) + '\n', 'utf8');
}
export interface Step { timestamp: string; event: string; state: Task['state']; detail: unknown }
export interface OrchestratorOptions {
  root: string;
  outputDirectory: string;
  pricing?: { researcher?: ResearcherPricing; writer?: WriterPricing; reviewer?: ReviewerPricing };
  onStep?: (step: Step) => void;
}

function inside(root: string, target: string): string {
  const path = resolve(root, target);
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Output must remain inside the SwarmBid root');
  return path;
}

export async function loadRealChain(root: string): Promise<EscrowChain> {
  const keyDir = join(root, '.near-testnet-keys');
  if (!existsSync(keyDir) || !existsSync(join(keyDir, BUYER_ACCOUNT + '.json'))) {
    throw new Error('Missing chain keys: .near-testnet-keys/buyer.garnett-swarmbid.testnet.json is required. No keys were created.');
  }
  // Node 24 loads the supplied TypeScript adapter as-is. Keep it lazy so
  // standalone worker checks need neither chain dependencies nor private keys.
  const adapterUrl = pathToFileURL(join(root, 'src', 'chain', 'escrow.ts')).href;
  let adapter: { createEscrowChain(): EscrowChain };
  try { adapter = await import(adapterUrl) as { createEscrowChain(): EscrowChain }; }
  catch { throw new Error('Cannot load the supplied chain adapter. Ensure its near-api-js dependency and valid buyer key file are available.'); }
  return adapter.createEscrowChain();
}

export async function orchestrate(input: ResearchTask, options: OrchestratorOptions): Promise<{
  task: Task; receipt: Receipt; steps: Step[]; deliverablePath?: string; sha256?: string;
}> {
  const root = resolve(options.root);
  if (input.buyerAccount !== BUYER_ACCOUNT) throw new Error('Task buyer must be buyer.garnett-swarmbid.testnet');
  const chain = await loadRealChain(root);
  const output = inside(root, options.outputDirectory);
  mkdirSync(output, { recursive: true });
  const board = new Board(input, chain, join(output, 'receipts.jsonl'));
  const steps: Step[] = [];
  let counter: CounterOffer | undefined;
  let deliverablePath: string | undefined;
  let digest: string | undefined;
  let settlementAttempted = false;
  const dashboardPath = inside(root, 'dashboard/data.json');
  function persist(): void {
    const task = board.task;
    const receipt = board.receipt;
    saveJson(join(output, 'report.json'), { task, steps, bids: task.bids, counteroffer: counter,
      txHashes: receipt?.txHashes ?? (task.escrowTxHash ? { createJob: task.escrowTxHash } : {}),
      deliverablePath, sha256: digest, receipt });
    // Same public fields and string summary as WO-004 data.sample.json.
    saveJson(dashboardPath, { tasks: [{ id: task.id, title: task.title, state: task.state,
      budgetYocto: task.budgetYocto, bids: task.bids, chosenBidId: task.chosenBidId ?? null,
      escrowTxHash: task.escrowTxHash ?? null, deliverable: task.deliverable ?? null }],
      receipts: receipt ? [{ ...receipt, checksSummary: receipt.checksSummary ?
        `${receipt.checksSummary.checks.filter(check => check.pass).length}/${receipt.checksSummary.checks.length}` : 'Unavailable' }] : [] });
  }
  function step(event: string, detail: unknown = {}): void {
    const entry: Step = { timestamp: new Date().toISOString(), event, state: board.task.state, detail };
    steps.push(entry);
    persist();
    options.onStep?.(entry);
  }
  try {
    saveJson(join(output, 'task.json'), input);
    step('Task published');
    board.startBidding();
    step('Bidding opened');
    const pricing = options.pricing ?? {};
    for (const bid of [quoteResearcher(input, pricing.researcher), quoteWriter(input, pricing.writer), quoteReviewer(input, pricing.reviewer)]) {
      step('Bid received', board.addBid(bid));
    }
    counter = board.closeBidding();
    if (counter) {
      step('Counteroffer sent', counter);
      const accepts: Record<string, (price: string) => boolean> = {
        [RESEARCHER_ACCOUNT]: price => acceptsResearcherCounter(price, pricing.researcher),
        [WRITER_ACCOUNT]: price => acceptsWriterCounter(price, pricing.writer),
        [REVIEWER_ACCOUNT]: price => acceptsReviewerCounter(price, pricing.reviewer),
      };
      const accepted = accepts[counter.workerAccount](counter.counterPriceYocto);
      board.respondToCounter(accepted);
      step('Counteroffer response', { accepted });
    }
    if (board.task.state === 'Cancelled') {
      step('Task cancelled');
      return { task: board.task, receipt: board.receipt!, steps };
    }
    step('Task awarded', { chosenBidId: board.task.chosenBidId, planPriceYocto: board.plannedPriceYocto });
    await board.fund(BUYER_ACCOUNT);
    step('Escrow funded', { txHash: board.task.escrowTxHash });
    // The winning account is the package contractor paid by escrow. All three
    // specialist stages execute for that package; their quotes compete for it.
    step('Research started');
    const notes = await research(input);
    saveJson(join(output, 'notes.json'), notes);
    step('Research completed', { points: notes.points.length, sources: notes.sources.length });
    const draft = await writeBriefing(notes, input);
    saveJson(join(output, 'writer-artifact.json'), draft);
    step('Writing completed', { degraded: draft.meta.degraded });
    const final = review(draft, input);
    deliverablePath = join(output, 'deliverable.md');
    digest = final.sha256;
    writeFileSync(deliverablePath, final.text, 'utf8');
    saveJson(join(output, 'deliverable.meta.json'), { ...final.meta, sha256: digest });
    step('Review completed', { deliverablePath, sha256: digest, degraded: final.meta.degraded });
    board.submitDeliverable({ path: deliverablePath, sha256: digest });
    step('Deliverable registered', board.task.deliverable);
    const checks = board.inspectDeliverable();
    step('Acceptance inspected', checks);
    settlementAttempted = true;
    const receipt = checks.pass ? await board.release(BUYER_ACCOUNT) : await board.refund(BUYER_ACCOUNT);
    step(checks.pass ? 'Payment released' : 'Payment refunded', { txHashes: receipt.txHashes });
    return { task: board.task, receipt, steps, deliverablePath, sha256: digest };
  } catch (error) {
    // A production/retrieval failure after funding is failed acceptance. Submit
    // the actual incomplete file (empty if no draft exists), inspect it, then
    // use the board's authorized Funded -> Refunded edge. Never fabricate work.
    if (board.task.state === 'Funded' && !settlementAttempted) {
      const failedPath = join(output, 'incomplete-deliverable.md');
      writeFileSync(failedPath, '', 'utf8');
      const { sha256 } = await import('../board/acceptance.js');
      deliverablePath = failedPath;
      digest = sha256('');
      board.submitDeliverable({ path: failedPath, sha256: digest });
      const checks = board.inspectDeliverable();
      step('Production failed; incomplete deliverable inspected', checks);
      if (!checks.pass) {
        let receipt: Receipt;
        try { receipt = await board.refund(BUYER_ACCOUNT); }
        catch {
          step('Refund failed', { message: 'Inspect the on-chain job before retrying settlement' });
          throw new Error('Refund failed. Inspect report.json and on-chain job state before retrying.');
        }
        step('Payment refunded after production failure', { txHashes: receipt.txHashes });
        return { task: board.task, receipt, steps, deliverablePath, sha256: digest };
      }
    }
    step('Run failed', { message: 'Operation failed; inspect persisted state before retrying any transaction' });
    // Chain/library errors can embed request details. Persist safe state and
    // report a fixed message rather than exposing secret-bearing diagnostics.
    void error;
    throw new Error('Demo operation failed. Inspect report.json and on-chain job state before retrying.');
  }
}
