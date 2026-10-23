export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface PoolClient extends Queryable {
  release(): void;
}

export interface LockingPool {
  connect(): Promise<PoolClient>;
}

/**
 * Runs the writes of one key (a product, an attribute, the settings) in a single transaction that holds an advisory
 * lock on that key. Concurrent requests for the same key wait for each other, so each one reads the state the previous
 * one committed (READ COMMITTED takes a new snapshot per statement) and the change and its audit rows are written
 * together or not at all.
 */
export async function withLock<T>(pool: LockingPool, key: string, work: (client: Queryable) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
