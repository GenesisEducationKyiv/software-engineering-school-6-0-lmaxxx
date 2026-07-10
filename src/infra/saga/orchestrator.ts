import { randomUUID as uuid } from 'node:crypto';
import {
  type SagaDefinition,
  type SagaOrchestrator,
  type SagaContext,
  type SagaRecord,
  type SagaStep,
  SagaStatus,
  StepStatus,
  SagaStepKind,
  SagaStepType,
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

export function createSagaOrchestrator(): SagaOrchestrator {
  type StepState =
    | { kind: 'finished' }
    | { kind: 'advance'; stepIndex: number }
    | { kind: 'run'; step: SagaStep; stepIndex: number; stepDbId: number; ctx: SagaContext };

  async function loadStepState(saga: SagaRecord, def: SagaDefinition): Promise<StepState> {
    const stepIndex = saga.currentStep;
    if (stepIndex >= def.steps.length) {
      await updateSagaStatus(saga.id, SagaStatus.Completed);
      return { kind: 'finished' };
    }

    const step = def.steps[stepIndex];
    const ctx: SagaContext = { sagaId: saga.id, state: { ...saga.state } };

    const existing = await findStepBySagaAndName(saga.id, step.name);
    if (existing) {
      if (existing.status === StepStatus.Completed) {
        return { kind: 'advance', stepIndex };
      }
      return { kind: 'run', step, stepIndex, stepDbId: existing.id, ctx };
    }

    const stepDbId = await insertSagaStep({
      sagaId: saga.id,
      stepIndex,
      stepName: step.name,
      stepType: SagaStepKind.Forward,
      status: StepStatus.InProgress,
    });
    return { kind: 'run', step, stepIndex, stepDbId, ctx };
  }

  async function executeLocalStep(
    saga: SagaRecord,
    def: SagaDefinition,
    step: SagaStep,
    stepIndex: number,
    stepDbId: number,
    ctx: SagaContext,
  ): Promise<void> {
    const result = (await step.action(ctx)) ?? {};
    const newState = { ...saga.state, ...result };
    await updateSagaStepStatus(stepDbId, StepStatus.Completed);
    await updateSagaStatus(saga.id, SagaStatus.StepInProgress, {
      currentStep: stepIndex + 1,
      state: newState,
    });
    const updatedSaga = await findSaga(saga.id);
    await executeStep(updatedSaga!, def);
  }

  async function executeActionStep(saga: SagaRecord, step: SagaStep, stepIndex: number): Promise<void> {
    // Dispatch the command to the participant service, then pause.
    // The step row stays IN_PROGRESS until the reply resumes the saga.
    await insertOutbox({
      routingKey: step.commandRoutingKey ?? `saga.command.${step.name}`,
      payload: { sagaId: saga.id, ...saga.state },
      sagaId: saga.id,
    });
    await updateSagaStatus(saga.id, SagaStatus.StepInProgress, {
      currentStep: stepIndex,
    });
  }

  async function executeWaitStep(saga: SagaRecord, stepIndex: number): Promise<void> {
    // WAIT: pause for an external signal (e.g. HTTP confirmation).
    // The step row stays IN_PROGRESS until completeStep resumes the saga.
    await updateSagaStatus(saga.id, SagaStatus.StepInProgress, {
      currentStep: stepIndex,
    });
  }

  /**
   * Drives the saga from its current step. LOCAL steps run synchronously and
   * recurse into the next step. ACTION and WAIT steps dispatch/await an external
   * signal and pause — the saga is resumed later via completeStep/failStep.
   */
  async function executeStep(saga: SagaRecord, def: SagaDefinition): Promise<void> {
    const state = await loadStepState(saga, def);
    if (state.kind === 'finished') return;
    if (state.kind === 'advance') {
      await updateSagaStatus(saga.id, SagaStatus.StepInProgress, {
        currentStep: state.stepIndex + 1,
      });
      const advanced = await findSaga(saga.id);
      await executeStep(advanced!, def);
      return;
    }

    const { step, stepIndex, stepDbId, ctx } = state;
    try {
      if (step.type === SagaStepType.Local) {
        await executeLocalStep(saga, def, step, stepIndex, stepDbId, ctx);
      } else if (step.type === SagaStepType.Action) {
        await executeActionStep(saga, step, stepIndex);
      } else {
        await executeWaitStep(saga, stepIndex);
      }
    } catch (err) {
      const message = errMessage(err);
      await updateSagaStepStatus(stepDbId, StepStatus.Failed, message);
      await compensate(saga, def, message);
    }
  }

  async function compensate(
    saga: SagaRecord,
    def: SagaDefinition,
    reason: string,
  ): Promise<void> {
    await updateSagaStatus(saga.id, SagaStatus.Compensating, {
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
        stepType: SagaStepKind.Compensate,
        status: StepStatus.InProgress,
      });

      try {
        await stepDef.compensate(ctx);
        await updateSagaStepStatus(compStepDbId, StepStatus.Completed);
      } catch (compErr) {
        await updateSagaStepStatus(compStepDbId, StepStatus.Failed, errMessage(compErr));
      }
    }

    await updateSagaStatus(saga.id, SagaStatus.Compensated);
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

      if (stepRecord.status === StepStatus.Completed) return;

      await updateSagaStepStatus(stepRecord.id, StepStatus.Completed);

      const newState = result ? { ...saga.state, ...result } : saga.state;
      await updateSagaStatus(sagaId, SagaStatus.StepInProgress, {
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
        await updateSagaStepStatus(stepRecord.id, StepStatus.Failed, reason);
      }

      const def = getDefinition(saga.sagaType);
      if (def) {
        await compensate(saga, def, reason);
      } else {
        await updateSagaStatus(sagaId, SagaStatus.Failed, { failReason: reason });
      }
    },

    async cancelSaga(sagaId) {
      await updateSagaStatus(sagaId, SagaStatus.Cancelled);
    },

    async recover() {
      // No-op: recovery of pending sagas is handled by recoverPendingSagas().
    },
  };
}
