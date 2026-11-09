import { research } from "../src/workers/dist/workers/researcher.js";
import fs from "node:fs";
const task = JSON.parse(fs.readFileSync("examples/sample-task.json", "utf8"));
for (let i = 1; i <= 4; i++) {
  const t0 = Date.now();
  try {
    const notes = await research(task);
    console.log(`run ${i}: OK points=${notes.points.length} ${((Date.now()-t0)/1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`run ${i}: FAIL ${((Date.now()-t0)/1000).toFixed(1)}s :: ${e.message.slice(0, 160)}`);
  }
}
