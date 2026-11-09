import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkAcceptance } from './acceptance.js';
import { ReceiptWriter } from './receipt.js';
import type {
  AcceptanceResult, Bid, BidInput, CounterOffer, Deliverable, EscrowChain,
  Receipt, Task, TaskInput, TaskState, TerminalState, TxHashes,
} from './types.js';

const EDGES: Readonly<Record<TaskState, readonly TaskState[]>> = {
  Open: ['Bidding', 'Cancelled'], Bidding: ['Negotiating', 'Cancelled'],
  Negotiating: ['Awarded'], Awarded: ['Funded'], Funded: ['Delivered', 'Refunded'],
  Delivered: ['Accepted'], Accepted: ['Released'], Released: [], Refunded: [], Cancelled: [],
};

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!EDGES[from]?.includes(to)) throw new Error(`Illegal transition: ${from} -> ${to}`);
}

export function yocto(value: string): bigint {
  if (!/^\d+$/u.test(value)) throw new Error('Amount must be an unsigned integer yocto string');
  return BigInt(value);
}

export class Board {
  private readonly data: Task;
  private readonly receipts: ReceiptWriter;
  private counter?: CounterOffer;
  private counterUsed = false;
  private checks: AcceptanceResult | null = null;
  private readonly hashes: TxHashes = {};
  private busy = false;
  private terminalReceipt?: Receipt;

  constructor(input: TaskInput, private readonly chain: EscrowChain, receiptPath: string) {
    yocto(input.budgetYocto);
    if (!Number.isSafeInteger(input.spec.minWords) || input.spec.minWords < 0) {
      throw new Error('minWords must be a nonnegative safe integer');
    }
    this.data = { ...structuredClone(input), state: 'Open', bids: [] };
    this.receipts = new ReceiptWriter(receiptPath);
  }

  get task(): Task { return structuredClone(this.data); }
  get pendingCounter(): CounterOffer | undefined { return structuredClone(this.counter); }
  get acceptance(): AcceptanceResult | null { return structuredClone(this.checks); }
  get receipt(): Receipt | undefined { return structuredClone(this.terminalReceipt); }
  get plannedPriceYocto(): string { return (yocto(this.data.budgetYocto) * 80n / 100n).toString(); }

  private requireState(...states: TaskState[]): void {
    if (this.busy) throw new Error('An operation is already in progress');
    if (!states.includes(this.data.state)) throw new Error(`Invalid state: ${this.data.state}`);
  }

  private move(to: TaskState): void {
    assertTransition(this.data.state, to);
    this.data.state = to;
  }

  startBidding(): void {
    this.requireState('Open');
    this.move('Bidding');
  }

  addBid(input: BidInput): Bid {
    this.requireState('Bidding');
    if (this.counterUsed) throw new Error('Bidding is closed');
    yocto(input.priceYocto);
    if (!Number.isSafeInteger(input.etaMinutes) || input.etaMinutes < 0) {
      throw new Error('etaMinutes must be a nonnegative safe integer');
    }
    const bid: Bid = { ...input, id: randomUUID(), round: 1 };
    this.data.bids.push(bid);
    return structuredClone(bid);
  }

  /** Close bids. Returns the sole counter, or awards/cancels immediately. */
  closeBidding(reason = 'Counteroffer at 80 percent of budget'): CounterOffer | undefined {
    this.requireState('Bidding');
    if (this.counterUsed) throw new Error('Bidding is already closed');
    const candidates = this.candidates();
    const lowest = candidates[0];
    if (!lowest) { this.finish('Cancelled'); return; }
    if (yocto(lowest.priceYocto) > yocto(this.plannedPriceYocto)) {
      this.counterUsed = true;
      this.counter = { bidId: lowest.id, workerAccount: lowest.workerAccount,
        counterPriceYocto: this.plannedPriceYocto, reason, round: 2 };
      return this.pendingCounter;
    }
    this.award(lowest);
    return undefined;
  }

  respondToCounter(accepted: boolean): void {
    this.requireState('Bidding');
    const counter = this.counter;
    if (!counter) throw new Error('No pending counteroffer');
    if (accepted) {
      const original = this.data.bids.find(bid => bid.id === counter.bidId)!;
      const revised: Bid = { ...original, id: randomUUID(), round: 2,
        priceYocto: counter.counterPriceYocto, reason: counter.reason };
      this.data.bids.push(revised);
      this.award(revised);
    } else {
      const next = this.candidates().find(bid => bid.id !== counter.bidId);
      if (next && yocto(next.priceYocto) <= yocto(this.data.budgetYocto)) this.award(next);
      else this.finish('Cancelled');
    }
    this.counter = undefined;
  }

  private candidates(): Bid[] {
    return this.data.bids.filter(bid => bid.round === 1).sort((left, right) => {
      const a = yocto(left.priceYocto), b = yocto(right.priceYocto);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  private award(bid: Bid): void {
    if (yocto(bid.priceYocto) > yocto(this.data.budgetYocto)) {
      this.finish('Cancelled');
      return;
    }
    this.move('Negotiating');
    this.data.chosenBidId = bid.id;
    this.move('Awarded');
  }

  private chosen(): Bid {
    const bid = this.data.bids.find(candidate => candidate.id === this.data.chosenBidId);
    if (!bid) throw new Error('No chosen bid');
    return bid;
  }

  async fund(buyerKey: string): Promise<void> {
    this.requireState('Awarded');
    this.busy = true;
    try {
      const bid = this.chosen();
      const { txHash } = await this.chain.createJob(this.data.id, bid.workerAccount, bid.priceYocto, buyerKey);
      this.hashes.createJob = txHash;
      this.data.escrowTxHash = txHash;
      this.move('Funded');
    } finally { this.busy = false; }
  }

  /** Registers a file while Funded; successful inspection commits Delivered -> Accepted. */
  submitDeliverable(deliverable: Deliverable): void {
    this.requireState('Funded');
    if (this.hashes.refund) throw new Error('Refund already submitted');
    if (!/^[a-f\d]{64}$/iu.test(deliverable.sha256)) throw new Error('Invalid SHA-256 digest');
    this.data.deliverable = { ...deliverable };
    this.checks = null;
  }

  inspectDeliverable(): AcceptanceResult {
    this.requireState('Funded');
    if (this.hashes.refund) throw new Error('Refund already submitted');
    const deliverable = this.data.deliverable;
    if (!deliverable) throw new Error('No registered deliverable');
    this.checks = checkAcceptance(readFileSync(deliverable.path), this.data.spec, deliverable.sha256);
    if (this.checks.pass) {
      this.move('Delivered');
      this.move('Accepted');
    }
    return structuredClone(this.checks);
  }

  async release(buyerKey: string): Promise<Receipt> {
    this.requireState('Accepted');
    this.busy = true;
    try {
      if (!this.hashes.release) {
        this.hashes.release = (await this.chain.release(this.data.id, buyerKey)).txHash;
      }
      return this.finish('Released');
    } finally { this.busy = false; }
  }

  async refund(buyerKey: string): Promise<Receipt> {
    this.requireState('Funded');
    if (!this.checks || this.checks.pass) throw new Error('Refund requires failed acceptance');
    this.busy = true;
    try {
      if (!this.hashes.refund) {
        this.hashes.refund = (await this.chain.refund(this.data.id, buyerKey)).txHash;
      }
      return this.finish('Refunded');
    } finally { this.busy = false; }
  }

  cancel(): Receipt {
    this.requireState('Open', 'Bidding');
    return this.finish('Cancelled');
  }

  private finish(result: TerminalState): Receipt {
    assertTransition(this.data.state, result);
    const bid = this.data.bids.find(candidate => candidate.id === this.data.chosenBidId);
    const receipt = this.receipts.append({ taskId: this.data.id, buyer: this.data.buyerAccount,
      worker: bid?.workerAccount ?? null, amountYocto: bid?.priceYocto ?? '0', result,
      checksSummary: structuredClone(this.checks), txHashes: { ...this.hashes } });
    this.move(result);
    this.data.receiptId = receipt.receiptId;
    this.terminalReceipt = receipt;
    return structuredClone(receipt);
  }
}
