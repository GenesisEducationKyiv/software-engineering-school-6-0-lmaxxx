import { v4 as uuid } from 'uuid';
import {
  type SagaDefinition,
  type SagaOrchestrator,
  type SagaContext,
  type SagaRecord,
} from './types.js';
import {
  insertSaga,
  findSaga,
  updateSagaStatus,
  insertSagaStep,
  updateSagaStepStatus,
  findStepBySagaAndName,
  findCompletedSteps,
} from './saga.repository.js';
import { insertOutbox } from './outbox.repository.js';
import { getDefinition } from '../../modules/sagas/registry.js';

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createSagaOrchestrator(
  _outboxEnabled: boolean,
): SagaOrchestrator {
  /**
   * Drives the saga from its current step. LOCAL steps run synchronously and
   * recurse into the next step. ACTION and WAIT steps dispatch/await an external
   * signal and pause — the saga is resumed later via completeStep/failStep.
   */
  async function executeStep(saga: SagaRecord, def: SagaDefinition): Promise<void> {
    const stepIndex = saga.currentStep;
    if (stepIndex >= def.steps.length) {
      await updateSagaStatus(saga.id, 'COMPLETED');
      return;
    }

    const step = def.steps[stepIndex];
    const ctx: SagaContext = { sagaId: saga.id, state: { ...saga.state } };

    const existing = await findStepBySagaAndName(saga.id, step.name);
    let stepDbId: number;

    if (existing) {
      if (existing.status === 'COMPLETED') {
        await updateSagaStatus(saga.id, 'STEP_IN_PROGRESS', {
          currentStep: stepIndex + 1,
        });
        const advanced = await findSaga(saga.id);
        await executeStep(advanced!, def);
        return;
      }
      stepDbId = existing.id;
    } else {
      stepDbId = await insertSagaStep({
        sagaId: saga.id,
        stepIndex,
        stepName: step.name,
        stepType: 'forward',
        status: 'IN_PROGRESS',
      });
    }

    try {
      if (step.type === 'LOCAL') {
        const result = (await step.action(ctx)) ?? {};
        const newState = { ...saga.state, ...result };
        await updateSagaStepStatus(stepDbId, 'COMPLETED');
        await updateSagaStatus(saga.id, 'STEP_IN_PROGRESS', {
          currentStep: stepIndex + 1,
          state: newState,
        });
        const updatedSaga = await findSaga(saga.id);
        await executeStep(updatedSaga!, def);
      } else if (step.type === 'ACTION') {
        // Dispatch the command to the participant service, then pause.
        // The step row stays IN_PROGRESS until the reply resumes the saga.
        await insertOutbox({
          routingKey: step.commandRoutingKey ?? `saga.command.${step.name}`,
          payload: { sagaId: saga.id, ...saga.state },
          sagaId: saga.id,
        });
        await updateSagaStatus(saga.id, 'STEP_IN_PROGRESS', {
          currentStep: stepIndex,
        });
      } else {
        // WAIT: pause for an external signal (e.g. HTTP confirmation).
        // The step row stays IN_PROGRESS until completeStep resumes the saga.
        await updateSagaStatus(saga.id, 'STEP_IN_PROGRESS', {
          currentStep: stepIndex,
        });
      }
    } catch (err) {
      const message = errMessage(err);
      await updateSagaStepStatus(stepDbId, 'FAILED', message);
      await compensate(saga, def, message);
    }
  }

  async function compensate(
    saga: SagaRecord,
    def: SagaDefinition,
    reason: string,
  ): Promise<void> {
    await updateSagaStatus(saga.id, 'COMPENSATING', {
      failReason: reason,
    });

    const completedSteps = await findCompletedSteps(saga.id);
    const ctx: SagaContext = { sagaId: saga.id, state: { ...saga.state } };

    for (const stepRecord of completedSteps.reverse()) {
      const stepDef = def.steps[stepRecord.stepIndex];
      if (!stepDef) continue;

      const compStepDbId = await insertSagaStep({
        sagaId: saga.id,
        stepIndex: stepRecord.stepIndex,
        stepName: stepDef.name,
        stepType: 'compensate',
        status: 'IN_PROGRESS',
      });

      try {
        await stepDef.compensate(ctx);
        await updateSagaStepStatus(compStepDbId, 'COMPLETED');
      } catch (compErr) {
        await updateSagaStepStatus(compStepDbId, 'FAILED', errMessage(compErr));
      }
    }

    await updateSagaStatus(saga.id, 'COMPENSATED');
  }

  return {
    async start(definition, initialState) {
      const sagaId = uuid();
      await insertSaga({
        id: sagaId,
        sagaType: definition.type,
        version: definition.version,
        state: initialState,
      });

      const saga = await findSaga(sagaId);
      await executeStep(saga!, definition);
      return sagaId;
    },

    async completeStep(sagaId, stepName, result) {
      const saga = await findSaga(sagaId);
      if (!saga) throw new Error(`Saga ${sagaId} not found`);

      const stepRecord = await findStepBySagaAndName(sagaId, stepName);
      if (!stepRecord) throw new Error(`Step ${stepName} not found for saga ${sagaId}`);

      if (stepRecord.status === 'COMPLETED') return;

      await updateSagaStepStatus(stepRecord.id, 'COMPLETED');

      const newState = result ? { ...saga.state, ...result } : saga.state;
      await updateSagaStatus(sagaId, 'STEP_IN_PROGRESS', {
        currentStep: stepRecord.stepIndex + 1,
        state: newState,
      });

      const updatedSaga = await findSaga(sagaId);
      const def = getDefinition(saga.sagaType);
      if (def) {
        await executeStep(updatedSaga!, def);
      }
    },

    async failStep(sagaId, stepName, reason) {
      const saga = await findSaga(sagaId);
      if (!saga) throw new Error(`Saga ${sagaId} not found`);

      const stepRecord = await findStepBySagaAndName(sagaId, stepName);
      if (stepRecord) {
        await updateSagaStepStatus(stepRecord.id, 'FAILED', reason);
      }

      const def = getDefinition(saga.sagaType);
      if (def) {
        await compensate(saga, def, reason);
      } else {
        await updateSagaStatus(sagaId, 'FAILED', { failReason: reason });
      }
    },

    async cancelSaga(sagaId) {
      await updateSagaStatus(sagaId, 'CANCELLED');
    },

    async recover() {
      // No-op: recovery of pending sagas is handled by recoverPendingSagas().
    },
  };
}
