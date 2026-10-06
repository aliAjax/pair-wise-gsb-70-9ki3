import type { ApiContract } from '../models/contract';
import type { SharedModel } from '../models/shared-model';

export const CONTRACTS_STORAGE_KEY = 'pair-wise-gsb-70-contracts';
export const MODELS_STORAGE_KEY = 'pair-wise-gsb-70-models';
export const SCHEMA_VERSION_KEY = 'pair-wise-gsb-70-schema-version';
export const CURRENT_SCHEMA_VERSION = 2;
export const LATENCY = 180;

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function wait(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, LATENCY));
}

export function loadContractsRaw(): ApiContract[] | null {
  const stored = localStorage.getItem(CONTRACTS_STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as ApiContract[];
  } catch {
    localStorage.removeItem(CONTRACTS_STORAGE_KEY);
    return null;
  }
}

export function persistContracts(contracts: ApiContract[]): void {
  localStorage.setItem(CONTRACTS_STORAGE_KEY, JSON.stringify(contracts));
}

export function loadModelsRaw(): SharedModel[] | null {
  const stored = localStorage.getItem(MODELS_STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as SharedModel[];
  } catch {
    localStorage.removeItem(MODELS_STORAGE_KEY);
    return null;
  }
}

export function persistModels(models: SharedModel[]): void {
  localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models));
}

export function getSchemaVersion(): number {
  return Number(localStorage.getItem(SCHEMA_VERSION_KEY) ?? '0') || 0;
}

export function setSchemaVersion(version: number): void {
  localStorage.setItem(SCHEMA_VERSION_KEY, String(version));
}

/** 保存时检测到其他窗口已写入新版本 */
export class SaveConflictError<T> extends Error {
  readonly entity: string;
  readonly stored: T;

  constructor(entity: string, stored: T) {
    super(`${entity}已被其他窗口修改，请确认对方改动后再保存`);
    this.name = 'SaveConflictError';
    this.entity = entity;
    this.stored = stored;
  }
}

export function getConflict<T>(error: unknown): { entity: string; stored: T } | null {
  if (error instanceof SaveConflictError) {
    return { entity: error.entity, stored: error.stored as T };
  }
  return null;
}
