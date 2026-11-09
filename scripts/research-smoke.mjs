import { research } from "../src/workers/dist/workers/researcher.js";
import fs from "node:fs";
const task = JSON.parse(fs.readFileSync("examples/sample-task.json", "utf8"));
try {
  const notes = await research(task);
  console.log("POINTS", notes.points.length, "SOURCES", notes.sources.length);
} catch (e) {
  console.log("RESEARCH_ERROR:", e.message);
}
