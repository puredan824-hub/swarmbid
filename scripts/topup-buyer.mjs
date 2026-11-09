import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import fs from "node:fs";
const saved = JSON.parse(fs.readFileSync(".near-testnet-keys/garnett-swarmbid.testnet.json", "utf8"));
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
const master = new Account("garnett-swarmbid.testnet", provider, KeyPairSigner.fromSecretKey(saved.private_key));
const outcome = await master.transfer({ receiverId: "buyer.garnett-swarmbid.testnet", amount: "300000000000000000000000" });
console.log("TOPUP_TX", outcome.transaction.hash);
