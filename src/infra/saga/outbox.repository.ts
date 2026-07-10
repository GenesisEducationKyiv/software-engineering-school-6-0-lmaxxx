import { pool } from '../db/pool.js';

export interface OutboxRecord {
  id: number;
  routingKey: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'SENT' | 'FAILED';
  sagaId: string | null;
  createdAt: Date;
}

export async function insertOutbox(entry: {
  routingKey: string;
  payload: Record<string, unknown>;
  sagaId?: string;
}): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO outbox (routing_key, payload, saga_id, status)
     VALUES ($1, $2, $3, 'PENDING')
     RETURNING id`,
    [entry.routingKey, JSON.stringify(entry.payload), entry.sagaId ?? null],
  );
  return result.rows[0].id;
}

export async function pollOutbox(limit = 50): Promise<OutboxRecord[]> {
  const result = await pool.query<OutboxRecord>(
    `SELECT id, routing_key AS "routingKey", payload, status, saga_id AS "sagaId", created_at AS "createdAt"
     FROM outbox WHERE status = 'PENDING' ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return result.rows;
}

export async function markOutboxSent(id: number): Promise<void> {
  await pool.query("UPDATE outbox SET status = 'SENT' WHERE id = $1", [id]);
}

export async function markOutboxFailed(id: number, _error: string): Promise<void> {
  await pool.query("UPDATE outbox SET status = 'FAILED' WHERE id = $1", [id]);
}
