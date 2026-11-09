import type { BidInput } from '../board/types.js';
import { sha256 } from '../board/acceptance.js';
import { yocto } from '../board/board.js';
import { REVIEWER_ACCOUNT } from '../chain/accounts.js';
import type { ResearchTask } from './researcher.js';
import type { Artifact } from './writer.js';

export interface ReviewerPricing { fixedYocto?: string; minimumCounterYocto?: string }
export function quoteReviewer(_task: ResearchTask, pricing: ReviewerPricing = {}): BidInput {
  return { workerAccount: REVIEWER_ACCOUNT, priceYocto: yocto(pricing.fixedYocto ?? '270000000000000000000000').toString(),
    etaMinutes: 3, reason: 'Fixed price for review and deterministic formatting' };
}
export function acceptsReviewerCounter(price: string, pricing: ReviewerPricing = {}): boolean {
  return yocto(price) >= yocto(pricing.minimumCounterYocto ?? '240000000000000000000000');
}
export function review(artifact: Artifact, task: ResearchTask): Artifact & { sha256: string } {
  let text = artifact.text.replace(/\r\n?/gu, '\n').replace(/[\u2018\u2019]/gu, "'")
    .replace(/[\u201c\u201d]/gu, '"').replace(/\u3002/gu, '.').replace(/\u3001|\uff0c/gu, ',');
  const headings = text.split('\n').map(line => line.trim().replace(/^#{1,6}\s+/u, '').replace(/\s+#+$/u, '').trim());
  for (const heading of task.spec.requiredSections) {
    if (!headings.includes(heading)) text += `\n\n## ${heading}\n`;
  }
  text = text.trim() + '\n';
  return { text, meta: { ...artifact.meta }, sha256: sha256(text) };
}
