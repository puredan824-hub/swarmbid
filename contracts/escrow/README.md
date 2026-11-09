| Method signature | Kind | Result and requirements |
| --- | --- | --- |
| `create_job({ job_id: string, worker: string })` | Payable call | Requires a new job ID and deposit > 0 yoctoNEAR. Stores caller as buyer, full deposit as amount, and state `Funded`. |
| `release({ job_id: string })` | Call | Buyer only; requires `Funded`. Sets `Released` and transfers the full amount to worker. Returns the transfer promise. |
| `refund({ job_id: string })` | Call | Buyer only; requires `Funded`. Sets `Refunded` and transfers the full amount to buyer. Returns the transfer promise. |
| `get_job({ job_id: string })` | View | Returns `{ buyer, worker, amount, state }` or `null`. Amount is a decimal U128 string in yoctoNEAR. |

Build with Node 24 in an environment supported by near-sdk-js (Linux, macOS, or WSL on Windows):

```sh
cd contracts/escrow
npm install && npm run build
```

Output: `build/escrow.wasm`.
