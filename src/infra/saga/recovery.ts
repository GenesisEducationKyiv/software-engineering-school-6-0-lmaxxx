import { type SagaOrchestrator, type SagaDefinition, type SagaRecord, SagaStepType, StepStatus } from './types.js';
import { findPendingSagas } from './saga.repository.js';
import { findStepBySagaAndName } from './saga.repository.js';
import { pollOutbox } from './outbox.repository.js';
import { logger } from '../../logger.js';

async function checkTimeout(
  saga: SagaRecord,
  def: SagaDefinition,
  orchestrator: SagaOrchestrator,
): Promise<boolean> {
  const step = def.steps[saga.currentStep];
  if (!step?.timeoutMs) return false;

  const elapsed = Date.now() - new Date(saga.updatedAt).getTime();
  if (elapsed > step.timeoutMs) {
    logger.info({ sagaId: saga.id, step: step.name }, `Saga ${saga.id}: step "${step.name}" timed out (${elapsed}ms > ${step.timeoutMs}ms), failing`);
    await orchestrator.failStep(saga.id, step.name, 'Timed out during recovery');
    return true;
  }
  return false;
}

export async function recoverPendingSagas(
  orchestrator: SagaOrchestrator,
  getDefinition: (type: string) => SagaDefinition | undefined,
): Promise<void> {
  const pending = await findPendingSagas();

  if (pending.length === 0) {
    logger.info('No pending sagas to recover');
    return;
  }

  logger.info({ count: pending.length }, `Recovering ${pending.length} pending saga(s)...`);

  for (const saga of pending) {
    const def = getDefinition(saga.sagaType);
    if (!def) {
      logger.warn({ sagaId: saga.id, sagaType: saga.sagaType }, `Unknown saga type "${saga.sagaType}" for saga ${saga.id}, marked FAILED`);
      continue;
    }

    const stepIndex = saga.currentStep;
    const step = def.steps[stepIndex];
    if (!step) {
      if (stepIndex >= def.steps.length) {
        logger.info({ sagaId: saga.id }, `Saga ${saga.id}: already past all steps, completing`);
      } else {
        logger.warn({ sagaId: saga.id, stepIndex }, `Saga ${saga.id}: step index ${stepIndex} out of range, completing`);
      }
      continue;
    }

    if (await checkTimeout(saga, def, orchestrator)) continue;

    if (step.type === SagaStepType.Action) {
      const stepRecord = await findStepBySagaAndName(saga.id, step.name);
      if (stepRecord && stepRecord.status === StepStatus.Completed) {
        logger.info({ sagaId: saga.id, step: step.name }, `Saga ${saga.id}: step "${step.name}" already completed, advancing`);
        try {
          await orchestrator.completeStep(saga.id, step.name);
        } catch (err) {
          logger.error({ sagaId: saga.id, err }, `Saga ${saga.id}: failed to advance during recovery`);
        }
      } else {
        const pendingOutbox = await pollOutbox(1).then(
          (rows) => rows.filter((r) => r.sagaId === saga.id),
        );
        if (pendingOutbox.length > 0) {
          logger.info({ sagaId: saga.id, step: step.name }, `Saga ${saga.id}: outbox entry pending for step "${step.name}", waiting`);
        } else {
          logger.info({ sagaId: saga.id, step: step.name }, `Saga ${saga.id}: step "${step.name}" awaiting reply, resuming`);
        }
      }
    } else if (step.type === SagaStepType.Wait) {
      logger.info({ sagaId: saga.id, step: step.name }, `Saga ${saga.id}: waiting for external signal on step "${step.name}"`);
    }
  }
}

export async function sweepTimedOutSagas(
  orchestrator: SagaOrchestrator,
  getDefinition: (type: string) => SagaDefinition | undefined,
): Promise<void> {
  const pending = await findPendingSagas();
  for (const saga of pending) {
    const def = getDefinition(saga.sagaType);
    if (!def) continue;
    await checkTimeout(saga, def, orchestrator);
  }
}

export function startSagaTimeoutSweep(
  orchestrator: SagaOrchestrator,
  getDefinition: (type: string) => SagaDefinition | undefined,
  intervalMs: number,
): { stop: () => void } {
  const interval = setInterval(() => {
    sweepTimedOutSagas(orchestrator, getDefinition).catch((err) =>
      logger.error({ err }, 'Saga timeout sweep failed'),
    );
  }, intervalMs);
  logger.info({ intervalMs }, `Saga timeout sweep started (interval: ${intervalMs}ms)`);
  return { stop: () => clearInterval(interval) };
}
