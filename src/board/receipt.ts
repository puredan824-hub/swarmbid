import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Receipt } from './types.js';

export class ReceiptWriter {
  constructor(private readonly path: string) {}

  append(input: Omit<Receipt, 'receiptId' | 'timestamp' | 'explorerLinks'>): Receipt {
    const receipt: Receipt = {
      ...input, receiptId: randomUUID(), timestamp: new Date().toISOString(),
      explorerLinks: Object.values(input.txHashes)
        .map(hash => `https://testnet.nearblocks.io/txns/${hash}`),
    };
    mkdirSync(dirname(this.path), { recursive: true });
    // Escape non-ASCII text so persisted log lines are ASCII, including user text.
    const line = JSON.stringify(receipt).replace(/[\u007f-\uffff]/g,
      character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    appendFileSync(this.path, `${line}\n`, 'utf8');
    return receipt;
  }
}
