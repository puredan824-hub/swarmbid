// Real EscrowChain implementation against the WO-001 escrow contract on testnet.
// Contract: escrow.garnett-swarmbid.testnet (WO-001, deployed + e2e verified).
// Keys are loaded from .near-testnet-keys/<account>.json at the swarmbid root.
// buyerKey parameter = the buyer account id whose key signs (e.g. "buyer.garnett-swarmbid.testnet").
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface EscrowChain {
  createJob(jobId: string, worker: string, amountYocto: string, buyerKey: string): Promise<{ txHash: string }>;
  release(jobId: string, buyerKey: string): Promise<{ txHash: string }>;
  refund(jobId: string, buyerKey: string): Promise<{ txHash: string }>;
}

const CONTRACT_ID = "escrow.garnett-swarmbid.testnet";
const GAS = "300000000000000";
function findKeyDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".near-testnet-keys");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(".near-testnet-keys directory not found above " + import.meta.url);
}
const keyDir = findKeyDir();
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });

function accountFor(accountId: string): Account {
  const saved = JSON.parse(fs.readFileSync(path.join(keyDir, accountId + ".json"), "utf8"));
  return new Account(accountId, provider, KeyPairSigner.fromSecretKey(saved.private_key));
}

export function createEscrowChain(): EscrowChain {
  async function call(buyerKey: string, methodName: string, args: Record<string, unknown>, deposit = "0"): Promise<{ txHash: string }> {
    const buyer = accountFor(buyerKey);
    const outcome = await buyer.callFunctionRaw({
      contractId: CONTRACT_ID,
      methodName,
      args,
      deposit,
      gas: GAS,
    });
    return { txHash: outcome.transaction.hash };
  }
  return {
    createJob: (jobId, worker, amountYocto, buyerKey) =>
      call(buyerKey, "create_job", { job_id: jobId, worker }, amountYocto),
    release: (jobId, buyerKey) => call(buyerKey, "release", { job_id: jobId }),
    refund: (jobId, buyerKey) => call(buyerKey, "refund", { job_id: jobId }),
  };
}

export async function getJob(jobId: string): Promise<unknown> {
  return provider.callFunction({ contractId: CONTRACT_ID, method: "get_job", args: { job_id: jobId } });
}
