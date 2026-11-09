export type TaskState = 'Open' | 'Bidding' | 'Negotiating' | 'Awarded' | 'Funded'
  | 'Delivered' | 'Accepted' | 'Released' | 'Refunded' | 'Cancelled';
export type TerminalState = Extract<TaskState, 'Released' | 'Refunded' | 'Cancelled'>;
export interface TaskSpec {
  minWords: number;
  requiredSections: string[];
  keywords: string[];
}
export interface Bid {
  id: string;
  workerAccount: string;
  priceYocto: string;
  etaMinutes: number;
  reason: string;
  round: 1 | 2;
}
export interface Deliverable { path: string; sha256: string }
export interface Task {
  id: string;
  buyerAccount: string;
  title: string;
  spec: TaskSpec;
  budgetYocto: string;
  state: TaskState;
  bids: Bid[];
  chosenBidId?: string;
  escrowTxHash?: string;
  deliverable?: Deliverable;
  receiptId?: string;
}
export type TaskInput = Pick<Task, 'id' | 'buyerAccount' | 'title' | 'spec' | 'budgetYocto'>;
export type BidInput = Omit<Bid, 'id' | 'round'>;
// Structural copy of the supplied contract; no chain implementation is included.
export interface EscrowChain {
  createJob(jobId: string, worker: string, amountYocto: string, buyerKey: string): Promise<{ txHash: string }>;
  release(jobId: string, buyerKey: string): Promise<{ txHash: string }>;
  refund(jobId: string, buyerKey: string): Promise<{ txHash: string }>;
}
export interface AcceptanceCheck { name: string; pass: boolean; detail: string }
export interface AcceptanceResult { pass: boolean; checks: AcceptanceCheck[] }
export interface CounterOffer {
  bidId: string;
  workerAccount: string;
  counterPriceYocto: string;
  reason: string;
  round: 2;
}
export interface TxHashes { createJob?: string; release?: string; refund?: string }
export interface Receipt {
  receiptId: string;
  taskId: string;
  buyer: string;
  worker: string | null;
  amountYocto: string;
  result: TerminalState;
  checksSummary: AcceptanceResult | null;
  txHashes: TxHashes;
  explorerLinks: string[];
  timestamp: string;
}
