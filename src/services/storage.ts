import { seedContracts, seedSharedModels } from '../data/seed';
import type { ApiContract } from '../models/contract';
import type { SharedModel } from '../models/shared-model';

export const CONTRACTS_KEY = 'pair-wise-gsb-70-contracts';
export const MODELS_KEY = 'pair-wise-gsb-70-models';
const META_KEY = 'pair-wise-gsb-70-meta';
const STORAGE_VERSION = 2;

export function clone<T>(value: T): T {
  return structuredClone(value);
}

function readMetaVersion(): number {
  const raw = localStorage.getItem(META_KEY);
  if (!raw) return 1;
  try {
    return (JSON.parse(raw) as { version?: number }).version ?? 1;
  } catch {
    return 1;
  }
}

function writeMetaVersion(): void {
  localStorage.setItem(META_KEY, JSON.stringify({ version: STORAGE_VERSION }));
}

/**
 * v1 → v2：旧数据没有共享模型引用信息，按内联定义迁移——
 * 保留契约内联 schema 作为生效定义，仅补充空引用列表与修订号，
 * 不改动 openapi 文本、变更列表与冻结版本。
 */
function migrateContract(contract: ApiContract): { contract: ApiContract; changed: boolean } {
  let changed = false;
  const next = { ...contract };
  if (typeof next.revision !== 'number') {
    next.revision = 1;
    changed = true;
  }
  if (!Array.isArray(next.modelRefs)) {
    next.modelRefs = [];
    changed = true;
  }
  return { contract: next, changed };
}

export function loadContracts(): ApiContract[] {
  const stored = localStorage.getItem(CONTRACTS_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as ApiContract[];
      let changed = readMetaVersion() < STORAGE_VERSION;
      const contracts = parsed.map((item) => {
        const migrated = migrateContract(item);
        changed = changed || migrated.changed;
        return migrated.contract;
      });
      if (changed) {
        persistContracts(contracts);
        writeMetaVersion();
      }
      return contracts;
    } catch {
      localStorage.removeItem(CONTRACTS_KEY);
    }
  }
  persistContracts(seedContracts);
  writeMetaVersion();
  return clone(seedContracts);
}

export function persistContracts(contracts: ApiContract[]): void {
  localStorage.setItem(CONTRACTS_KEY, JSON.stringify(contracts));
}

export function loadModels(): SharedModel[] {
  const stored = localStorage.getItem(MODELS_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as SharedModel[];
    } catch {
      localStorage.removeItem(MODELS_KEY);
    }
  }
  persistModels(seedSharedModels);
  return clone(seedSharedModels);
}

export function persistModels(models: SharedModel[]): void {
  localStorage.setItem(MODELS_KEY, JSON.stringify(models));
}
