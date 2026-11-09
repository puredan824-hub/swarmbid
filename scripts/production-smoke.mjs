import { research } from "../src/workers/dist/workers/researcher.js";
import { writeBriefing } from "../src/workers/dist/workers/writer.js";
import { review } from "../src/workers/dist/workers/reviewer.js";
import fs from "node:fs";
const task = JSON.parse(fs.readFileSync("examples/sample-task.json", "utf8"));
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const notes = await research(task);
    console.log(`attempt ${attempt}: research OK points=${notes.points.length} sources=${notes.sources.length}`);
    const draft = await writeBriefing(notes, task);
    console.log(`attempt ${attempt}: write OK degraded=${draft.meta.degraded} method=${draft.meta.method}`);
    const fin = review(draft, task);
    console.log(`attempt ${attempt}: review OK sha256=${fin.sha256.slice(0, 16)}...`);
    break;
  } catch (e) {
    console.log(`attempt ${attempt}: ERROR:`, e.message);
  }
}
