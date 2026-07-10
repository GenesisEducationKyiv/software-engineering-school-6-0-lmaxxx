import { type SagaOrchestrator, type SagaDefinition, type SagaRecord, SagaStepType, StepStatus } from './types.js';
import { findPendingSagas } from './saga.repository.js';
import { findStepBySagaAndName } from './saga.repository.js';
import { pollOutbox } from './outbox.repository.js';

async function checkTimeout(
  saga: SagaRecord,
  def: SagaDefinition,
  orchestrator: SagaOrchestrator,
): Promise<boolean> {
  const step = def.steps[saga.currentStep];
  if (!step?.timeoutMs) return false;

  const elapsed = Date.now() - new Date(saga.updatedAt).getTime();
  if (elapsed > step.timeoutMs) {
    console.log(`Saga ${saga.id}: step "${step.name}" timed out (${elapsed}ms > ${step.timeoutMs}ms), failing`);
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
    console.log('No pending sagas to recover');
    return;
  }

  console.log(`Recovering ${pending.length} pending saga(s)...`);

  for (const saga of pending) {
    const def = getDefinition(saga.sagaType);
    if (!def) {
      console.warn(`Unknown saga type "${saga.sagaType}" for saga ${saga.id}, marked FAILED`);
      continue;
    }

    const stepIndex = saga.currentStep;
    const step = def.steps[stepIndex];
    if (!step) {
      if (stepIndex >= def.steps.length) {
        console.log(`Saga ${saga.id}: already past all steps, completing`);
      } else {
        console.warn(`Saga ${saga.id}: step index ${stepIndex} out of range, completing`);
      }
      continue;
    }

    if (await checkTimeout(saga, def, orchestrator)) continue;

    if (step.type === SagaStepType.Action) {
      const stepRecord = await findStepBySagaAndName(saga.id, step.name);
      if (stepRecord && stepRecord.status === StepStatus.Completed) {
        console.log(`Saga ${saga.id}: step "${step.name}" already completed, advancing`);
        await orchestrator.completeStep(saga.id, step.name);
      } else {
        const pendingOutbox = await pollOutbox(1).then(
          (rows) => rows.filter((r) => r.sagaId === saga.id),
        );
        if (pendingOutbox.length > 0) {
          console.log(`Saga ${saga.id}: outbox entry pending for step "${step.name}", waiting`);
        } else {
          console.log(`Saga ${saga.id}: step "${step.name}" awaiting reply, resuming`);
        }
      }
    } else if (step.type === SagaStepType.Wait) {
      console.log(`Saga ${saga.id}: waiting for external signal on step "${step.name}"`);
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
      console.error('Saga timeout sweep failed:', err),
    );
  }, intervalMs);
  console.log(`Saga timeout sweep started (interval: ${intervalMs}ms)`);
  return { stop: () => clearInterval(interval) };
}
