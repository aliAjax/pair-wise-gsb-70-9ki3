import type { ApiContract } from '../models/contract';
import {
  applyModelDiffToContract,
  diffSharedModelFields,
  type ModelFieldDiff,
  type SharedModel,
} from '../models/shared-model';
import { SaveConflictError } from './save-conflict';
import { clone, loadContracts, loadModels, persistContracts, persistModels } from './storage';

const LATENCY = 180;

async function wait(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, LATENCY));
}

export async function listSharedModels(): Promise<SharedModel[]> {
  await wait();
  return loadModels();
}

export async function getSharedModel(id: string): Promise<SharedModel | undefined> {
  const models = await listSharedModels();
  return models.find((model) => model.id === id);
}

export interface ModelSaveResult {
  model: SharedModel;
  diffs: ModelFieldDiff[];
  affected: Array<{
    contractId: string;
    contractName: string;
    added: number;
    removed: number;
    invalidated: number;
  }>;
}

/**
 * 保存共享模型并按引用关系重算受影响契约：
 * 删字段、改类型、加必填会使引用契约上的旧评审结论失效并回到待评审；
 * 冻结契约与已冻结版本快照不被模型变化改写。
 * 提供 expectedRevision 时执行乐观并发校验，冲突则抛出 SaveConflictError。
 */
export async function saveSharedModel(
  input: SharedModel,
  options?: { expectedRevision?: number },
): Promise<ModelSaveResult> {
  const models = loadModels();
  const existing = models.find((model) => model.id === input.id);
  if (
    existing &&
    options?.expectedRevision !== undefined &&
    existing.revision !== options.expectedRevision
  ) {
    throw new SaveConflictError('model', clone(existing));
  }
  const now = new Date().toISOString();
  const diffs = existing ? diffSharedModelFields(existing.fields, input.fields) : [];
  const saved: SharedModel = {
    ...input,
    revision: existing ? existing.revision + 1 : 1,
    updatedAt: now,
  };
  persistModels(
    existing ? models.map((model) => (model.id === saved.id ? saved : model)) : [...models, saved],
  );

  const contracts = loadContracts();
  const affected: ModelSaveResult['affected'] = [];
  const nextContracts = contracts.map((contract) => {
    if (contract.status === 'frozen') return contract;
    if (!contract.modelRefs.some((ref) => ref.modelId === saved.id)) return contract;
    const result = applyModelDiffToContract(contract, saved, diffs, now);
    if (!result.changed) return contract;
    affected.push({
      contractId: contract.id,
      contractName: contract.name,
      added: result.added,
      removed: result.removed,
      invalidated: result.invalidated,
    });
    return {
      ...result.contract,
      revision: contract.revision + 1,
      updatedAt: now,
    };
  });
  if (affected.length) {
    persistContracts(nextContracts);
  }
  await wait();
  return { model: clone(saved), diffs, affected };
}

/** 引用该模型的契约清单（含冻结契约，仅用于展示影响面） */
export async function listReferencingContracts(modelId: string): Promise<ApiContract[]> {
  const contracts = loadContracts();
  await wait();
  return contracts.filter((contract) =>
    contract.modelRefs.some((ref) => ref.modelId === modelId),
  );
}
