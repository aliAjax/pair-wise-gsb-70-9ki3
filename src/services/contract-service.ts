import type {
  ApiContract,
  ContractChange,
  ContractVersion,
  ReviewState,
} from '../models/contract';
import {
  applyModelDiffToContract,
  diffSharedModelFields,
  resolveContractOpenApi,
} from '../models/shared-model';
import { stableChecksum, formatDateTime } from '../lib/utils';
import { SaveConflictError } from './save-conflict';
import { clone, loadContracts, loadModels, persistContracts } from './storage';

const LATENCY = 180;

async function wait(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, LATENCY));
}

export async function listContracts(): Promise<ApiContract[]> {
  await wait();
  return loadContracts();
}

export async function getContract(id: string): Promise<ApiContract | undefined> {
  const contracts = await listContracts();
  return contracts.find((contract) => contract.id === id);
}

/**
 * 整份保存契约。提供 expectedRevision 时执行乐观并发校验：
 * 存储修订号领先则抛出 SaveConflictError，由调用方保留草稿并展示对方改动。
 * 冻结版本快照只允许通过 freezeVersion 追加，整份保存不得改写。
 */
export async function saveContract(
  updated: ApiContract,
  options?: { expectedRevision?: number },
): Promise<ApiContract> {
  const contracts = loadContracts();
  const existing = contracts.find((contract) => contract.id === updated.id);
  if (
    existing &&
    options?.expectedRevision !== undefined &&
    existing.revision !== options.expectedRevision
  ) {
    throw new SaveConflictError('contract', clone(existing));
  }
  const saved: ApiContract = {
    ...updated,
    versions: existing ? existing.versions : updated.versions,
    revision: existing ? existing.revision + 1 : 1,
    updatedAt: new Date().toISOString(),
  };
  const next = existing
    ? contracts.map((contract) => (contract.id === saved.id ? saved : contract))
    : [saved, ...contracts];
  persistContracts(next);
  await wait();
  return clone(saved);
}

export async function reviewChange(
  contractId: string,
  changeId: string,
  reviewState: ReviewState,
  reviewer: string,
  comment: string,
): Promise<ApiContract> {
  const contracts = loadContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }

  const updated: ApiContract = {
    ...contract,
    status: contract.status === 'draft' ? 'review' : contract.status,
    revision: contract.revision + 1,
    updatedAt: new Date().toISOString(),
    changes: contract.changes.map((change) =>
      change.id === changeId
        ? {
            ...change,
            reviewState,
            reviewer,
            reviewComment: comment,
            reviewedAt: new Date().toISOString(),
          }
        : change,
    ),
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

export async function bulkReviewChanges(
  selections: Array<{ contractId: string; changeId: string }>,
  reviewState: ReviewState,
  reviewer: string,
  comment: string,
): Promise<ApiContract[]> {
  const contracts = loadContracts();
  const selected = new Set(selections.map((item) => `${item.contractId}:${item.changeId}`));
  const updated = contracts.map((contract) => {
    const touched = contract.changes.some((change) =>
      selected.has(`${contract.id}:${change.id}`),
    );
    if (!touched) return contract;
    return {
      ...contract,
      status: contract.status === 'draft' ? ('review' as const) : contract.status,
      revision: contract.revision + 1,
      updatedAt: new Date().toISOString(),
      changes: contract.changes.map((change) =>
        selected.has(`${contract.id}:${change.id}`)
          ? {
              ...change,
              reviewState,
              reviewer,
              reviewComment: comment,
              reviewedAt: new Date().toISOString(),
            }
          : change,
      ),
    };
  });
  persistContracts(updated);
  await wait();
  return clone(updated);
}

/** 基于最新存储内容更新单个变更，避免整份覆盖其他窗口的编辑 */
export async function patchContractChange(
  contractId: string,
  changeId: string,
  patch: Partial<ContractChange>,
): Promise<ApiContract> {
  const contracts = loadContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const updated: ApiContract = {
    ...contract,
    revision: contract.revision + 1,
    updatedAt: new Date().toISOString(),
    changes: contract.changes.map((change) =>
      change.id === changeId ? { ...change, ...patch } : change,
    ),
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

export async function updateContractOpenApi(
  contractId: string,
  openapi: string,
  options?: { expectedRevision?: number },
): Promise<ApiContract> {
  const contracts = loadContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  if (
    options?.expectedRevision !== undefined &&
    contract.revision !== options.expectedRevision
  ) {
    throw new SaveConflictError('contract', clone(contract));
  }
  const updated = {
    ...contract,
    openapi,
    revision: contract.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

/**
 * 调整契约的共享模型引用。新引用的模型按"字段从无到有"生成派生变更；
 * 移除引用时同步移除该模型的派生变更。冻结契约不允许调整引用。
 */
export async function setContractModelRefs(
  contractId: string,
  modelIds: string[],
): Promise<ApiContract> {
  const contracts = loadContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  if (contract.status === 'frozen') {
    throw new Error('契约已冻结，不能调整共享模型引用');
  }
  const models = loadModels();
  const now = new Date().toISOString();
  const previousIds = contract.modelRefs.map((ref) => ref.modelId);
  const detached = previousIds.filter((id) => !modelIds.includes(id));
  const attached = modelIds.filter((id) => !previousIds.includes(id));

  let next: ApiContract = {
    ...contract,
    modelRefs: modelIds.map((modelId) => ({
      modelId,
      modelName: models.find((model) => model.id === modelId)?.name ?? modelId,
    })),
    changes: contract.changes.filter(
      (change) => !(change.source && detached.includes(change.source.modelId)),
    ),
  };
  for (const modelId of attached) {
    const model = models.find((item) => item.id === modelId);
    if (!model) continue;
    const result = applyModelDiffToContract(
      next,
      model,
      diffSharedModelFields([], model.fields),
      now,
    );
    next = result.contract;
  }
  const updated: ApiContract = {
    ...next,
    revision: contract.revision + 1,
    updatedAt: now,
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

export async function addExemption(
  contractId: string,
  changeId: string,
  reason: string,
): Promise<ApiContract> {
  const contracts = loadContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const exemption = {
    id: `ex-${Date.now()}`,
    changeId,
    scope: contract.changes.find((item) => item.id === changeId)?.path ?? '未指定',
    reason,
    approvedBy: '当前评审人',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  };
  const updated: ApiContract = {
    ...contract,
    revision: contract.revision + 1,
    updatedAt: new Date().toISOString(),
    exemptions: [...contract.exemptions, exemption],
    changes: contract.changes.map((change) =>
      change.id === changeId ? { ...change, reviewState: 'exemption' } : change,
    ),
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

/**
 * 冻结正式版本。快照写入解析后的生效定义（内联 + 引用模型）并记录模型基线，
 * 之后的模型变化不会改写已冻结快照。
 */
export async function freezeVersion(
  contractId: string,
  version: string,
  notes: string,
): Promise<ApiContract> {
  const contracts = loadContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const models = loadModels();
  const resolved = resolveContractOpenApi(contract, models);

  const release: ContractVersion = {
    id: `ver-${Date.now()}`,
    contractId,
    version,
    releasedAt: new Date().toISOString(),
    checksum: stableChecksum(resolved),
    notes,
    changeIds: contract.changes.map((change) => change.id),
    openapi: resolved,
    modelPins: contract.modelRefs.map((ref) => ({
      modelId: ref.modelId,
      modelName: ref.modelName,
      revision: models.find((model) => model.id === ref.modelId)?.revision ?? 0,
    })),
  };
  const updated: ApiContract = {
    ...contract,
    version,
    status: 'frozen',
    revision: contract.revision + 1,
    updatedAt: new Date().toISOString(),
    versions: [release, ...contract.versions],
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

export function generateExampleRequest(contract: ApiContract, change?: ContractChange): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contract.openapi);
  } catch {
    parsed = null;
  }
  const openapi = parsed as
    | {
        paths?: Record<string, Record<string, { summary?: string }>>;
      }
    | null;
  const candidates = openapi?.paths ? Object.entries(openapi.paths) : [];
  const selectedPath = change?.path ?? candidates[0]?.[0] ?? '/resource';
  const selectedMethod = (
    change?.method ??
    (candidates[0]?.[1] ? Object.keys(candidates[0][1])[0] : 'get')
  ).toUpperCase();
  const fields = change
    ? [change.after.replace(/^新增|移除|变为/g, '').trim()]
    : ['orderId: ORD-20260929-001', 'requestId: req-local-demo'];

  return JSON.stringify(
    {
      method: selectedMethod,
      url: `https://api.example.com${selectedPath.replace('{orderId}', 'ORD-20260929-001').replace('{paymentId}', 'PAY-90218').replace('{userId}', 'U-1024')}`,
      headers: {
        Authorization: 'Bearer <token>',
        'X-Client-Version': contract.version,
      },
      body:
        selectedMethod === 'GET'
          ? undefined
          : Object.fromEntries(
              fields.map((field) => {
                const [key, value] = field.split(':').map((item) => item.trim());
                return [key || 'field', value || 'value'];
              }),
            ),
    },
    null,
    2,
  );
}

export function buildChangeReport(contract: ApiContract): string {
  const lines = [
    `# ${contract.name} ${contract.version} 契约变更报告`,
    '',
    `- 领域：${contract.domain}`,
    `- 负责人：${contract.owner}`,
    `- 状态：${contract.status}`,
    `- 生成时间：${new Date().toISOString()}`,
    '',
    '## 引用共享模型',
    ...(contract.modelRefs.length
      ? contract.modelRefs.map((ref) => `- ${ref.modelName}`)
      : ['- 无（契约使用内联定义）']),
    '',
    '## 变更明细',
    ...contract.changes.flatMap((change) => [
      `### ${change.method} ${change.path} - ${change.kind}`,
      `- 兼容性：${change.compatibility}`,
      `- 来源：${change.source ? `共享模型 ${change.source.modelName}` : '契约内联定义'}`,
      `- 变更前：${change.before}`,
      `- 变更后：${change.after}`,
      `- 判定依据：${change.rationale}`,
      `- 调用方影响：${change.impactStatement || '未填写'}`,
      `- 迁移方案：${change.migrationPlan || '未填写'}`,
      `- 评审结论：${change.reviewState}`,
      ...(change.invalidation
        ? [
            `- 结论失效：${change.invalidation.reason}（原结论 ${change.invalidation.previousState} · ${change.invalidation.previousReviewer || '未指定'}）`,
          ]
        : []),
      '',
    ]),
    '## 调用方',
    ...contract.consumers.map(
      (consumer) =>
        `- ${consumer.name} / ${consumer.owner} / ${consumer.environment} / ${consumer.clientVersion}`,
    ),
    '',
    '## 豁免记录',
    ...(contract.exemptions.length
      ? contract.exemptions.map(
          (item) => `- ${item.scope}：${item.reason}（至 ${item.expiresAt}）`,
        )
      : ['- 无']),
  ];
  return lines.join('\n');
}

export function diffVersionSummary(contract: ApiContract): string {
  const previous = contract.versions[0];
  if (!previous) {
    return '无可比较的历史正式版本。';
  }
  return [
    `上一版 ${previous.version}`,
    `发布于 ${formatDateTime(previous.releasedAt)}`,
    `校验值 ${previous.checksum}`,
    `本版变更 ${contract.changes.length} 项`,
  ].join('\n');
}
