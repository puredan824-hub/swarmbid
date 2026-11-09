# SwarmBid Hackathon Notes

## Created within the hackathon window

All code in this repository was created during the NEAR Hackathon window. The project was started on 2026-11-09 and every component — the escrow contract (`contracts/escrow`), the task board state machine (`src/board`), the chain adapter (`src/chain`), the workers (`src/workers`), the orchestrator (`src/orchestrator`), the one-click demo (`src/demo`) and the read-only dashboard (`dashboard/`) — was written from scratch for this submission.

## Baseline disclosure

There is no baseline or pre-existing product code in this repository. Nothing was ported from an earlier product. The only external code is published open-source libraries, declared in the README (near-api-js 7.4.0, near-sdk-js 2.0.0, TypeScript 5.9.3).

## AI-generated code disclosure

The code was written by an AI coding agent (OpenAI Codex, GPT-5-class model) working from written work orders (specification, inputs/outputs, acceptance criteria) issued by the maintainer. Every work order's output was reviewed by the maintainer, rebuilt locally under strict TypeScript, and verified against live NEAR testnet behavior (deployment, escrow deposit/release/refund transactions, and three full demo runs whose transaction hashes are listed in the README) before being accepted. No code was accepted on the agent's word alone.

## Testnet statement

The project runs entirely on NEAR testnet (hackathon rules Q-010 explicitly allow testnet-only entries). It uses no mainnet accounts and no real funds.
