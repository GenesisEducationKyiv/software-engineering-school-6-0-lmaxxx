export const SagaStatus = {
  Pending: 'PENDING',
  StepInProgress: 'STEP_IN_PROGRESS',
  Completed: 'COMPLETED',
  Failed: 'FAILED',
  Compensating: 'COMPENSATING',
  Compensated: 'COMPENSATED',
  Cancelled: 'CANCELLED',
} as const;
export type SagaStatus = (typeof SagaStatus)[keyof typeof SagaStatus];

export const StepStatus = {
  Pending: 'PENDING',
  InProgress: 'IN_PROGRESS',
  Completed: 'COMPLETED',
  Failed: 'FAILED',
} as const;
export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];

export const SagaStepKind = {
  Forward: 'forward',
  Compensate: 'compensate',
} as const;
export type SagaStepKind = (typeof SagaStepKind)[keyof typeof SagaStepKind];

export interface SagaRecord {
  id: string;
  sagaType: string;
  version: number;
  status: SagaStatus;
  currentStep: number;
  state: Record<string, unknown>;
  failReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SagaStepRecord {
  id: number;
  sagaId: string;
  stepIndex: number;
  stepName: string;
  stepType: SagaStepKind;
  status: StepStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}

export interface SagaContext {
  sagaId: string;
  state: Record<string, unknown>;
}

export type SagaAction = (ctx: SagaContext) => Promise<Record<string, unknown> | void>;
export type SagaCompensate = (ctx: SagaContext) => Promise<void>;

export const SagaStepType = {
  Local: 'LOCAL',
  Action: 'ACTION',
  Wait: 'WAIT',
} as const;
export type SagaStepType = (typeof SagaStepType)[keyof typeof SagaStepType];

export interface SagaStep {
  name: string;
  action: SagaAction;
  compensate: SagaCompensate;
  timeoutMs?: number;
  type: SagaStepType;
  commandRoutingKey?: string;
}

export interface SagaDefinition {
  type: string;
  version: number;
  steps: SagaStep[];
}

export interface SagaOrchestrator {
  start(definition: SagaDefinition, initialState: Record<string, unknown>): Promise<string>;
  completeStep(sagaId: string, stepName: string, result?: Record<string, unknown>): Promise<void>;
  failStep(sagaId: string, stepName: string, reason: string): Promise<void>;
  cancelSaga(sagaId: string): Promise<void>;
  recover(): Promise<void>;
}
