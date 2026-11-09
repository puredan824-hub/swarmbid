// Real retrieval and generation only. No chain adapter or keys are needed.
// Run after building src/workers, from the SwarmBid root:
// node examples/run-smoke.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { research, quoteResearcher } from '../src/workers/dist/workers/researcher.js';
import { writeBriefing, quoteWriter } from '../src/workers/dist/workers/writer.js';
import { review, quoteReviewer } from '../src/workers/dist/workers/reviewer.js';
import { checkAcceptance } from '../src/workers/dist/board/acceptance.js';
const ascii = value => value.replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const save = (path, value) => writeFileSync(path, ascii(JSON.stringify(value, null, 2)) + '\n');
try {
  const task = JSON.parse(readFileSync(new URL('./sample-task.json', import.meta.url), 'utf8'));
  console.log('Starting real Wikipedia and DuckDuckGo retrieval');
  const notes = await research(task);
  const draft = await writeBriefing(notes, task);
  const final = review(draft, task);
  const acceptance = checkAcceptance(final.text, task.spec, final.sha256);
  if (!acceptance.pass) throw new Error('Standalone acceptance failed');
  writeFileSync(new URL('./sample-deliverable.md', import.meta.url), final.text);
  save(new URL('./sample-deliverable.meta.json', import.meta.url), { ...final.meta, sha256: final.sha256 });
  save(new URL('./sample-notes.json', import.meta.url), notes);
  const result = { points: notes.points.length, sources: notes.sources.length, degraded: final.meta.degraded,
    bids: [quoteResearcher(task), quoteWriter(task), quoteReviewer(task)], acceptance, sha256: final.sha256 };
  save(new URL('./smoke-result.json', import.meta.url), result);
  console.log(ascii(JSON.stringify(result, null, 2)));
} catch (error) {
  console.error(ascii(`ERROR: ${error instanceof Error ? error.message : 'Smoke failed'}`));
  process.exitCode = 1;
}
