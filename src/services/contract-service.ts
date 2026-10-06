import { seedContracts, seedModels } from '../data/seed';
import type {
  ApiContract,
  ContractChange,
  ContractVersion,
  ReviewState,
} from '../models/contract';
import { stableChecksum, formatDateTime } from '../lib/utils';
import { migrateLegacyContracts, needsMigration } from './migration';
import {
  CURRENT_SCHEMA_VERSION,
  SaveConflictError,
  clone,
  getSchemaVersion,
  loadContractsRaw,
  persistContracts,
  persistModels,
  setSchemaVersion,
  wait,
} from './storage';

export async function listContracts(): Promise<ApiContract[]> {
  await wait();
  const stored = loadContractsRaw();
  if (!stored) {
    persistContracts(seedContracts);
    persistModels(seedModels);
    setSchemaVersion(CURRENT_SCHEMA_VERSION);
    return clone(seedContracts);
  }
  if (getSchemaVersion() < CURRENT_SCHEMA_VERSION || stored.some(needsMigration)) {
    const migrated = migrateLegacyContracts(stored);
    persistContracts(migrated);
    setSchemaVersion(CURRENT_SCHEMA_VERSION);
    return clone(migrated);
  }
  return stored;
}

export async function getContract(id: string): Promise<ApiContract | undefined> {
  const contracts = await listContracts();
  return contracts.find((contract) => contract.id === id);
}

export async function saveContract(
  updated: ApiContract,
  baseRevision?: number,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const stored = contracts.find((contract) => contract.id === updated.id);
  if (stored && baseRevision !== undefined && stored.revision !== baseRevision) {
    throw new SaveConflictError('契约', clone(stored));
  }
  const saved: ApiContract = {
    ...updated,
    revision: (stored?.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  const next = stored
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
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }

  const updated: ApiContract = {
    ...contract,
    revision: contract.revision + 1,
    status: contract.status === 'draft' ? 'review' : contract.status,
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
  const contracts = await listContracts();
  const selected = new Set(selections.map((item) => `${item.contractId}:${item.changeId}`));
  const updated = contracts.map((contract) => {
    const matched = contract.changes.some((change) =>
      selected.has(`${contract.id}:${change.id}`),
    );
    if (!matched) return contract;
    return {
      ...contract,
      revision: contract.revision + 1,
      status: contract.status === 'draft' ? ('review' as const) : contract.status,
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

export async function updateContractOpenApi(
  contractId: string,
  openapi: string,
  baseRevision?: number,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  if (baseRevision !== undefined && contract.revision !== baseRevision) {
    throw new SaveConflictError('契约', clone(contract));
  }
  const updated: ApiContract = {
    ...contract,
    openapi,
    revision: contract.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

/** 单条变更的字段级更新，基于存储中的最新数据合并，避免整份覆盖 */
export async function updateChangeFields(
  contractId: string,
  changeId: string,
  patch: Partial<ContractChange>,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const updated: ApiContract = {
    ...contract,
    revision: contract.revision + 1,
    changes: contract.changes.map((change) =>
      change.id === changeId ? { ...change, ...patch } : change,
    ),
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
  const contracts = await listContracts();
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
    exemptions: [...contract.exemptions, exemption],
    changes: contract.changes.map((change) =>
      change.id === changeId ? { ...change, reviewState: 'exemption' } : change,
    ),
  };
  persistContracts(contracts.map((item) => (item.id === contractId ? updated : item)));
  await wait();
  return clone(updated);
}

export async function freezeVersion(
  contractId: string,
  version: string,
  notes: string,
): Promise<ApiContract> {
  const contracts = await listContracts();
  const contract = contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }

  const release: ContractVersion = {
    id: `ver-${Date.now()}`,
    contractId,
    version,
    releasedAt: new Date().toISOString(),
    checksum: stableChecksum(contract.openapi),
    notes,
    changeIds: contract.changes.map((change) => change.id),
    openapi: contract.openapi,
    modelRefs: clone(contract.modelRefs),
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
      ? contract.modelRefs.map(
          (ref) => `- ${ref.modelId} · ${ref.method} ${ref.path} · 同步至 v${ref.modelVersion}`,
        )
      : ['- 无（字段定义内联维护）']),
    '',
    '## 变更明细',
    ...contract.changes.flatMap((change) => [
      `### ${change.method} ${change.path} - ${change.kind}`,
      `- 兼容性：${change.compatibility}`,
      `- 变更前：${change.before}`,
      `- 变更后：${change.after}`,
      `- 判定依据：${change.rationale}`,
      `- 调用方影响：${change.impactStatement || '未填写'}`,
      `- 迁移方案：${change.migrationPlan || '未填写'}`,
      `- 评审结论：${change.reviewState}`,
      ...(change.source
        ? [`- 来源：共享模型 ${change.source.modelId} / 字段 ${change.source.field}`]
        : []),
      ...(change.invalidated
        ? [
            `- 结论失效：${change.invalidated.reason}（原结论 ${change.invalidated.previousState}）`,
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
