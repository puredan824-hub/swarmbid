import { createHash } from 'node:crypto';
import type { AcceptanceResult, TaskSpec } from './types.js';

export function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export function checkAcceptance(
  content: string | Uint8Array, spec: TaskSpec, expectedSha256?: string,
): AcceptanceResult {
  const text = typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
  const wordCount = text.trim() ? text.trim().split(/\s+/u).length : 0;
  // Match a complete plain or Markdown heading line, never a prose substring.
  const headings = text.split(/\r?\n/u).map(line => line.trim()
    .replace(/^#{1,6}\s+/u, '').replace(/\s+#+$/u, '').trim());
  const checks = [{ name: 'wordCount', pass: wordCount >= spec.minWords,
    detail: `Measured ${wordCount} words; minimum ${spec.minWords}` }];
  for (const section of spec.requiredSections) {
    checks.push({ name: `section:${section}`, pass: headings.includes(section),
      detail: `Required heading: ${section}` });
  }
  for (const keyword of spec.keywords) {
    checks.push({ name: `keyword:${keyword}`, pass: text.toLowerCase().includes(keyword.toLowerCase()),
      detail: `Required keyword: ${keyword}` });
  }
  if (expectedSha256 !== undefined) {
    const actual = sha256(content);
    checks.push({ name: 'sha256', pass: actual === expectedSha256.toLowerCase(),
      detail: `Measured ${actual}; expected ${expectedSha256}` });
  }
  return { pass: checks.every(check => check.pass), checks };
}
