import type { SagaDefinition } from '../../infra/saga/types.js';

const definitions = new Map<string, SagaDefinition>();

export function registerDefinition(def: SagaDefinition): void {
  definitions.set(def.type, def);
}

export function getDefinition(sagaType: string): SagaDefinition | undefined {
  return definitions.get(sagaType);
}
