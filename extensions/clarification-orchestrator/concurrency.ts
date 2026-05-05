export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private limit: number;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Semaphore limit must be at least 1.");
    this.limit = limit;
  }

  get concurrency(): number {
    return this.limit;
  }

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  setConcurrency(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Semaphore limit must be at least 1.");
    this.limit = limit;
    this.drain();
  }

  reduceConcurrency(minimum = 1): number {
    this.setConcurrency(Math.max(minimum, this.limit - 1));
    return this.limit;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }

    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    return () => this.release();
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  private drain(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) return;
      next();
      // The released waiter increments active after its await resumes.
      break;
    }
  }
}

export async function runBounded<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const semaphore = new Semaphore(concurrency);
  const results = new Array<R>(items.length);
  await Promise.all(
    items.map((item, index) =>
      semaphore.run(async () => {
        results[index] = await worker(item, index);
      }),
    ),
  );
  return results;
}

export function shouldReduceConcurrencyForRateLimits(recentErrorTypes: string[], threshold = 2): boolean {
  return recentErrorTypes.filter((type) => type === "rate-limit").length >= threshold;
}
