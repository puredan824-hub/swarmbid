import { loadRealChain } from "../src/demo/dist/orchestrator/orchestrator.js";
import path from "node:path";
const root = path.resolve(".");
const chain = await loadRealChain(root);
const buyer = "buyer.garnett-swarmbid.testnet";
const jobId = "swarmbid-diag-" + Date.now();
try {
  const c = await chain.createJob(jobId, "researcher.garnett-swarmbid.testnet", "240000000000000000000000", buyer);
  console.log("createJob 0.24 OK", c.txHash);
  const r = await chain.refund(jobId, buyer);
  console.log("refund OK (diag cleanup)", r.txHash);
} catch (e) {
  console.log("ERROR name:", e?.constructor?.name);
  console.log("ERROR message:", String(e?.message).slice(0, 400));
  if (e?.error?.message) console.log("inner:", String(e.error.message).slice(0, 300));
  if (e?.type) console.log("type:", e.type);
}
