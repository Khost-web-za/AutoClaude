export type CacheLoad<T> = { value: T; validUntil: number };

/** In-memory cache whose entries carry their own expiry; concurrent loads of one key share a request. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; validUntil: number }>();
  private readonly loading = new Map<string, Promise<T>>();

  constructor(private readonly now: () => number) {}

  async getOrLoad(key: string, load: () => Promise<CacheLoad<T>>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.validUntil > this.now()) return hit.value;
    const pending = this.loading.get(key);
    if (pending) return pending;
    const promise = load()
      .then((loaded) => {
        this.entries.set(key, loaded);
        return loaded.value;
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, promise);
    return promise;
  }

  clear(): void {
    this.entries.clear();
  }
}
