import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import fs from "node:fs";
const saved = JSON.parse(fs.readFileSync(".near-testnet-keys/researcher.garnett-swarmbid.testnet.json", "utf8"));
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
const from = new Account("researcher.garnett-swarmbid.testnet", provider, KeyPairSigner.fromSecretKey(saved.private_key));
const outcome = await from.transfer({ receiverId: "buyer.garnett-swarmbid.testnet", amount: "350000000000000000000000" });
console.log("TOPUP2_TX", outcome.transaction.hash);
