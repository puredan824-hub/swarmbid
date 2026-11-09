import { NearBindgen, NearPromise, LookupMap, assert, call, near, view } from "near-sdk-js";

enum JobState {
  Funded = "Funded",
  Released = "Released",
  Refunded = "Refunded",
}

type Job = {
  buyer: string;
  worker: string;
  // Decimal U128 yoctoNEAR string for lossless storage and JSON output.
  amount: string;
  state: JobState;
};

@NearBindgen({})
class Escrow {
  jobs: LookupMap<Job> = new LookupMap<Job>("jobs");

  // Record the predecessor as buyer and escrow the entire attached deposit.
  @call({ payableFunction: true })
  create_job({ job_id, worker }: { job_id: string; worker: string }): void {
    assert(this.jobs.get(job_id) === null, "Job already exists");
    const amount = near.attachedDeposit();
    assert(amount > 0n, "Attached deposit must be greater than zero");
    this.jobs.set(job_id, {
      buyer: near.predecessorAccountId(),
      worker,
      amount: amount.toString(),
      state: JobState.Funded,
    });
  }

  // Close the funded job before scheduling its full payment to the worker.
  @call({})
  release({ job_id }: { job_id: string }): NearPromise {
    const job = this.jobs.get(job_id);
    assert(job !== null, "Job does not exist");
    assert(near.predecessorAccountId() === job.buyer, "Only the buyer can release this job");
    assert(job.state === JobState.Funded, "Job must be Funded");
    job.state = JobState.Released;
    this.jobs.set(job_id, job);
    return NearPromise.new(job.worker).transfer(BigInt(job.amount));
  }

  // Close the funded job before scheduling its full refund to the buyer.
  @call({})
  refund({ job_id }: { job_id: string }): NearPromise {
    const job = this.jobs.get(job_id);
    assert(job !== null, "Job does not exist");
    assert(near.predecessorAccountId() === job.buyer, "Only the buyer can refund this job");
    assert(job.state === JobState.Funded, "Job must be Funded");
    job.state = JobState.Refunded;
    this.jobs.set(job_id, job);
    return NearPromise.new(job.buyer).transfer(BigInt(job.amount));
  }

  // Return the stored JSON record, or null when the identifier is unknown.
  @view({})
  get_job({ job_id }: { job_id: string }): Job | null {
    return this.jobs.get(job_id);
  }
}
