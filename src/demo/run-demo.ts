import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ascii, orchestrate } from '../orchestrator/orchestrator.js';
import type { ResearchTask } from '../workers/researcher.js';

function projectRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (directory !== parse(directory).root) {
    if (existsSync(join(directory, 'workorders', 'WO-003-workers-orchestrator.md'))) return directory;
    directory = dirname(directory);
  }
  throw new Error('Cannot locate the SwarmBid root');
}

try {
  const root = projectRoot();
  const input = JSON.parse(readFileSync(join(root, 'examples', 'sample-task.json'), 'utf8')) as ResearchTask;
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  input.id = `swarmbid-${stamp}-${randomUUID().slice(0, 8)}`;
  const outputDirectory = join(root, 'output', `demo-${input.id}`);
  console.log('SwarmBid testnet demo starting');
  const result = await orchestrate(input, { root, outputDirectory,
    onStep: step => console.log(ascii(`${step.timestamp} ${step.state}: ${step.event} ${JSON.stringify(step.detail)}`)) });
  console.log(ascii(`Report: ${join(outputDirectory, 'report.json')}`));
  console.log(ascii(JSON.stringify(result.receipt, null, 2)));
  for (const link of result.receipt.explorerLinks) console.log(ascii(link));
  if (result.task.state !== 'Released') process.exitCode = 1;
} catch (error) {
  console.error(ascii(`ERROR: ${error instanceof Error ? error.message : 'Demo failed'}`));
  process.exitCode = 1;
}
