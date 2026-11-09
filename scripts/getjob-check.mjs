import { getJob } from "../src/chain/dist/escrow.js";

console.log("run2 job:", JSON.stringify(await getJob("swarmbid-2026-11-08T20-12-57-094Z-579685e6")));
