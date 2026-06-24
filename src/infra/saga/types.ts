export type SagaStatus =
  | 'PENDING'
  | 'STEP_IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'COMPENSATING'
  | 'COMPENSATED'
  | 'CANCELLED';

export type StepStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

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
  stepType: 'forward' | 'compensate';
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

export type SagaStepType = 'LOCAL' | 'ACTION' | 'WAIT';

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
