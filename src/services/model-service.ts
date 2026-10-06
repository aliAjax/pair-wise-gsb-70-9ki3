import type { ApiContract, ContractChange } from '../models/contract';
import type { ModelBinding, SharedModel } from '../models/shared-model';
import {
  describeFieldDelta,
  sameSnapshot,
  snapshotOfModel,
  touchedFieldNames,
} from '../models/shared-model';
import { listContracts } from './contract-service';
import {
  SaveConflictError,
  clone,
  loadModelsRaw,
  persistContracts,
  persistModels,
  wait,
} from './storage';

export async function listSharedModels(): Promise<SharedModel[]> {
  await wait();
  return loadModelsRaw() ?? [];
}

export async function getSharedModel(id: string): Promise<SharedModel | undefined> {
  const models = await listSharedModels();
  return models.find((model) => model.id === id);
}

export interface ModelRecomputeSummary {
  contractId: string;
  contractName: string;
  created: number;
  invalidated: number;
  removed: number;
  skippedFrozen: boolean;
}

export interface SaveSharedModelOutcome {
  model: SharedModel;
  affected: ModelRecomputeSummary[];
}

/**
 * 保存共享模型并按引用关系重算受影响契约：
 * - 模型删字段、改类型或加必填会生成/更新对应契约差异；
 * - 差异内容发生变化时，旧评审结论失效并回到待评审；
 * - 冻结契约与其版本快照不被模型变化改写。
 */
export async function saveSharedModel(
  model: SharedModel,
  baseRevision: number,
): Promise<SaveSharedModelOutcome> {
  const models = await listSharedModels();
  const stored = models.find((item) => item.id === model.id);
  if (stored && stored.revision !== baseRevision) {
    throw new SaveConflictError('共享模型', clone(stored));
  }
  const now = new Date().toISOString();
  const saved: SharedModel = {
    ...model,
    version: (stored?.version ?? 0) + 1,
    revision: (stored?.revision ?? 0) + 1,
    updatedAt: now,
  };
  persistModels(
    stored ? models.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...models],
  );

  const contracts = await listContracts();
  const affected: ModelRecomputeSummary[] = [];
  let recomputed = false;
  const nextContracts = contracts.map((contract) => {
    const bindings = contract.modelRefs.filter((binding) => binding.modelId === saved.id);
    if (!bindings.length) return contract;
    if (contract.status === 'frozen') {
      affected.push({
        contractId: contract.id,
        contractName: contract.name,
        created: 0,
        invalidated: 0,
        removed: 0,
        skippedFrozen: true,
      });
      return contract;
    }
    const outcome = recomputeContractChanges(contract, bindings, stored, saved, now);
    recomputed = true;
    affected.push({
      contractId: contract.id,
      contractName: contract.name,
      created: outcome.created,
      invalidated: outcome.invalidated,
      removed: outcome.removed,
      skippedFrozen: false,
    });
    return outcome.contract;
  });
  if (recomputed) {
    persistContracts(nextContracts);
  }
  await wait();
  return { model: clone(saved), affected };
}

interface RecomputeOutcome {
  contract: ApiContract;
  created: number;
  invalidated: number;
  removed: number;
}

function recomputeContractChanges(
  contract: ApiContract,
  bindings: ModelBinding[],
  previous: SharedModel | undefined,
  next: SharedModel,
  now: string,
): RecomputeOutcome {
  const touched = touchedFieldNames(previous?.fields ?? [], next.fields);
  let created = 0;
  let invalidated = 0;
  let removed = 0;
  let changes = [...contract.changes];

  for (const binding of bindings) {
    for (const fieldName of touched) {
      const index = changes.findIndex(
        (change) =>
          change.source?.modelId === next.id &&
          change.source.field === fieldName &&
          change.path === binding.path &&
          change.method === binding.method,
      );
      const existing = index >= 0 ? changes[index] : undefined;
      const origin = existing?.source ? existing.source.origin : snapshotOfModel(previous, fieldName);
      const current = snapshotOfModel(next, fieldName);

      if (sameSnapshot(origin, current)) {
        // 模型改回原始定义，对应差异撤销
        if (existing) {
          changes = changes.filter((_, itemIndex) => itemIndex !== index);
          removed += 1;
        }
        continue;
      }

      const rendered = describeFieldDelta(fieldName, origin, current);
      if (!existing) {
        const change: ContractChange = {
          id: `chg-${next.id}-${fieldName}-${Date.now()}-${created}`,
          path: binding.path,
          method: binding.method,
          ...rendered,
          impactStatement: '',
          migrationPlan: '',
          reviewState: 'pending',
          reviewer: '',
          reviewComment: '',
          source: { modelId: next.id, field: fieldName, origin },
        };
        changes.push(change);
        created += 1;
        continue;
      }

      const signatureChanged =
        existing.kind !== rendered.kind ||
        existing.before !== rendered.before ||
        existing.after !== rendered.after;
      if (!signatureChanged) continue;

      const wasReviewed = existing.reviewState !== 'pending';
      changes[index] = {
        ...existing,
        ...rendered,
        reviewState: 'pending',
        invalidated: wasReviewed
          ? {
              at: now,
              reason: `共享模型「${next.name}」已更新至 v${next.version}，字段 ${fieldName} 的定义发生变化，原评审结论失效，需重新确认。`,
              previousState: existing.reviewState,
            }
          : existing.invalidated,
      };
      if (wasReviewed) invalidated += 1;
    }
  }

  const hasDelta = created + invalidated + removed > 0;
  return {
    contract: {
      ...contract,
      changes,
      status: hasDelta && contract.status === 'ready' ? 'review' : contract.status,
      modelRefs: contract.modelRefs.map((binding) =>
        binding.modelId === next.id ? { ...binding, modelVersion: next.version } : binding,
      ),
      revision: contract.revision + 1,
      updatedAt: now,
    },
    created,
    invalidated,
    removed,
  };
}
