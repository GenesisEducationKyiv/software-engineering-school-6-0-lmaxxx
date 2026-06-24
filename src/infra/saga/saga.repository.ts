import { pool } from '../db/pool.js';
import type { SagaRecord, SagaStepRecord, SagaStatus, StepStatus } from './types.js';

export async function insertSaga(saga: {
  id: string;
  sagaType: string;
  version: number;
  state: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO sagas (id, saga_type, version, status, current_step, state)
     VALUES ($1, $2, $3, 'PENDING', 0, $4)`,
    [saga.id, saga.sagaType, saga.version, JSON.stringify(saga.state)],
  );
}

export async function findSaga(id: string): Promise<SagaRecord | null> {
  const result = await pool.query<SagaRecord>(
    'SELECT * FROM sagas WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findPendingSagas(): Promise<SagaRecord[]> {
  const result = await pool.query<SagaRecord>(
    "SELECT * FROM sagas WHERE status IN ('PENDING', 'STEP_IN_PROGRESS') ORDER BY created_at",
  );
  return result.rows;
}

export async function updateSagaStatus(
  id: string,
  status: SagaStatus,
  updates?: { currentStep?: number; state?: Record<string, unknown>; failReason?: string | null },
): Promise<void> {
  const sets: string[] = ['status = $2', 'updated_at = current_timestamp'];
  const params: unknown[] = [id, status];
  let idx = 3;

  if (updates?.currentStep !== undefined) {
    sets.push(`current_step = $${idx++}`);
    params.push(updates.currentStep);
  }
  if (updates?.state !== undefined) {
    sets.push(`state = $${idx++}`);
    params.push(JSON.stringify(updates.state));
  }
  if (updates?.failReason !== undefined) {
    sets.push(`fail_reason = $${idx++}`);
    params.push(updates.failReason);
  }

  await pool.query(
    `UPDATE sagas SET ${sets.join(', ')} WHERE id = $1`,
    params,
  );
}

export async function insertSagaStep(step: {
  sagaId: string;
  stepIndex: number;
  stepName: string;
  stepType: 'forward' | 'compensate';
  status: StepStatus;
}): Promise<void> {
  await pool.query(
    `INSERT INTO saga_steps (saga_id, step_index, step_name, step_type, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [step.sagaId, step.stepIndex, step.stepName, step.stepType, step.status],
  );
}

export async function updateSagaStepStatus(
  id: number,
  status: StepStatus,
  error?: string | null,
): Promise<void> {
  const sets: string[] = ['status = $2'];
  const params: unknown[] = [id, status];

  if (status === 'IN_PROGRESS') {
    sets.push('started_at = current_timestamp');
  } else if (status === 'COMPLETED' || status === 'FAILED') {
    sets.push('finished_at = current_timestamp');
  }
  if (error !== undefined) {
    sets.push('error = $3');
    params.push(error);
  }

  await pool.query(
    `UPDATE saga_steps SET ${sets.join(', ')} WHERE id = $1`,
    params,
  );
}

export async function findStepBySagaAndName(
  sagaId: string,
  stepName: string,
): Promise<SagaStepRecord | null> {
  const result = await pool.query<SagaStepRecord>(
    'SELECT * FROM saga_steps WHERE saga_id = $1 AND step_name = $2 AND step_type = \'forward\' ORDER BY step_index DESC LIMIT 1',
    [sagaId, stepName],
  );
  return result.rows[0] ?? null;
}

export async function findCompletedSteps(
  sagaId: string,
): Promise<SagaStepRecord[]> {
  const result = await pool.query<SagaStepRecord>(
    "SELECT * FROM saga_steps WHERE saga_id = $1 AND step_type = 'forward' AND status = 'COMPLETED' ORDER BY step_index",
    [sagaId],
  );
  return result.rows;
}
