import { createEscrowChain, getJob } from "../src/chain/dist/escrow.js";
const chain = createEscrowChain();
const buyer = "buyer.garnett-swarmbid.testnet";
const jobId = "probe-" + Date.now();
try {
  const c = await chain.createJob(jobId, "researcher.garnett-swarmbid.testnet", "1000000000000000000000", buyer);
  console.log("createJob OK", c.txHash);
  console.log("getJob:", JSON.stringify(await getJob(jobId)));
  const r = await chain.release(jobId, buyer);
  console.log("release OK", r.txHash);
  console.log("getJob after:", JSON.stringify(await getJob(jobId)));
} catch (e) {
  console.log("CHAIN_ERROR name:", e.constructor?.name, "| message:", String(e.message).slice(0, 300));
  if (e.error?.message) console.log("inner:", String(e.error.message).slice(0, 200));
}
