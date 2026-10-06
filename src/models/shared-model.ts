import type { ApiContract, ChangeKind, ContractChange } from './contract';
import { classifyChange } from './contract';

export interface SharedModelField {
  name: string;
  type: string;
  required: boolean;
  enumValues: string[];
}

export interface SharedModel {
  id: string;
  name: string;
  domain: string;
  owner: string;
  description: string;
  fields: SharedModelField[];
  /** 乐观并发修订号：两个窗口同时编辑时，后保存者据此发现冲突 */
  revision: number;
  updatedAt: string;
}

export type ModelDiffKind =
  | 'field_removed'
  | 'type_changed'
  | 'required_added'
  | 'required_relaxed'
  | 'field_added_required'
  | 'field_added_optional'
  | 'enum_expanded';

export interface ModelFieldDiff {
  field: string;
  kind: ModelDiffKind;
  before: string;
  after: string;
  /** 删字段、改类型、加必填会使引用契约上的旧评审结论失效 */
  invalidating: boolean;
  summary: string;
}

export const MODEL_DIFF_KIND_LABELS: Record<ModelDiffKind, string> = {
  field_removed: '删除字段',
  type_changed: '修改类型',
  required_added: '改为必填',
  required_relaxed: '改为可选',
  field_added_required: '新增必填字段',
  field_added_optional: '新增可选字段',
  enum_expanded: '枚举扩展',
};

export function diffSharedModelFields(
  before: SharedModelField[],
  after: SharedModelField[],
): ModelFieldDiff[] {
  const diffs: ModelFieldDiff[] = [];
  const afterByName = new Map(after.map((field) => [field.name, field]));
  const beforeNames = new Set(before.map((field) => field.name));

  for (const oldField of before) {
    const next = afterByName.get(oldField.name);
    if (!next) {
      diffs.push({
        field: oldField.name,
        kind: 'field_removed',
        before: `字段 ${oldField.name}: ${oldField.type}${oldField.required ? '（必填）' : '（可选）'}`,
        after: `移除 ${oldField.name}`,
        invalidating: true,
        summary: `删除字段 ${oldField.name}`,
      });
      continue;
    }
    if (next.type !== oldField.type) {
      diffs.push({
        field: oldField.name,
        kind: 'type_changed',
        before: `${oldField.name}: ${oldField.type}`,
        after: `${oldField.name}: ${next.type}（类型变化）`,
        invalidating: true,
        summary: `修改字段 ${oldField.name} 类型（${oldField.type} → ${next.type}）`,
      });
    }
    if (!oldField.required && next.required) {
      diffs.push({
        field: oldField.name,
        kind: 'required_added',
        before: `${oldField.name} 为可选字段`,
        after: `${oldField.name} 变为必填字段`,
        invalidating: true,
        summary: `将字段 ${oldField.name} 改为必填`,
      });
    } else if (oldField.required && !next.required) {
      diffs.push({
        field: oldField.name,
        kind: 'required_relaxed',
        before: `${oldField.name} 为必填字段`,
        after: `${oldField.name} 变为可选字段`,
        invalidating: false,
        summary: `将字段 ${oldField.name} 改为可选`,
      });
    }
    const oldEnum = oldField.enumValues;
    const newEnum = next.enumValues;
    if (newEnum.length > oldEnum.length && oldEnum.every((value) => newEnum.includes(value))) {
      diffs.push({
        field: oldField.name,
        kind: 'enum_expanded',
        before: `${oldField.name}: ${oldEnum.join(' | ')}`,
        after: `${oldField.name}: ${newEnum.join(' | ')}`,
        invalidating: false,
        summary: `扩展字段 ${oldField.name} 枚举值（新增 ${newEnum.slice(oldEnum.length).join('、')}）`,
      });
    }
  }

  for (const newField of after) {
    if (beforeNames.has(newField.name)) continue;
    diffs.push({
      field: newField.name,
      kind: newField.required ? 'field_added_required' : 'field_added_optional',
      before: `字段集合不含 ${newField.name}`,
      after: `新增${newField.required ? '必填' : '可选'}字段 ${newField.name}: ${newField.type}`,
      invalidating: newField.required,
      summary: `新增${newField.required ? '必填' : '可选'}字段 ${newField.name}`,
    });
  }
  return diffs;
}

const DIFF_TO_CHANGE_KIND: Record<ModelDiffKind, ChangeKind> = {
  field_removed: 'field_removed',
  type_changed: 'type_changed',
  required_added: 'optionality_changed',
  required_relaxed: 'optionality_changed',
  field_added_required: 'field_added',
  field_added_optional: 'field_added',
  enum_expanded: 'enum_expanded',
};

/** 同一字段的同类派生变更使用稳定分组，重算时按 ID 覆盖更新 */
const DIFF_GROUP: Record<ModelDiffKind, string> = {
  field_removed: 'removed',
  field_added_required: 'added',
  field_added_optional: 'added',
  type_changed: 'type',
  required_added: 'optionality',
  required_relaxed: 'optionality',
  enum_expanded: 'enum',
};

function derivedChangeId(contractId: string, modelId: string, field: string, group: string): string {
  return `chg-${contractId}-${modelId}-${field}-${group}`.replace(/[^a-zA-Z0-9-]/g, '_');
}

export interface RecomputeResult {
  contract: ApiContract;
  changed: boolean;
  added: number;
  removed: number;
  invalidated: number;
}

/**
 * 按模型 diff 重算单个引用契约的派生变更。
 * 删字段、改类型、加必填会使对应变更上的旧评审结论失效，需重新确认；
 * 反向修改（如字段恢复）会抵消此前的派生变更。
 */
export function applyModelDiffToContract(
  contract: ApiContract,
  model: SharedModel,
  diffs: ModelFieldDiff[],
  now: string,
): RecomputeResult {
  let mutated = false;
  let added = 0;
  let removed = 0;
  let invalidated = 0;

  // 模型改名时同步既有派生变更的来源信息
  let changes = contract.changes.map((change) => {
    if (change.source?.modelId !== model.id || change.source.modelName === model.name) {
      return change;
    }
    mutated = true;
    return {
      ...change,
      path: `${model.name}.${change.source.field}`,
      source: { ...change.source, modelName: model.name },
    };
  });

  for (const diff of diffs) {
    const group = DIFF_GROUP[diff.kind];
    const id = derivedChangeId(contract.id, model.id, diff.field, group);
    const source = { modelId: model.id, modelName: model.name, field: diff.field };

    if (diff.kind === 'field_removed') {
      // 字段被删除后，此前"新增该字段"的派生变更不再成立
      const inverseId = derivedChangeId(contract.id, model.id, diff.field, 'added');
      const before = changes.length;
      changes = changes.filter((change) => change.id !== inverseId);
      if (changes.length !== before) {
        mutated = true;
        removed += before - changes.length;
      }
    }
    if (diff.kind === 'field_added_required' || diff.kind === 'field_added_optional') {
      const inverseId = derivedChangeId(contract.id, model.id, diff.field, 'removed');
      if (changes.some((change) => change.id === inverseId)) {
        // 字段恢复：删除与新增相互抵消，不再产生新变更
        changes = changes.filter((change) => change.id !== inverseId);
        mutated = true;
        removed += 1;
        continue;
      }
    }

    const kind = DIFF_TO_CHANGE_KIND[diff.kind];
    const classified = classifyChange({ kind, before: diff.before, after: diff.after });
    const existing = changes.find((change) => change.id === id);

    if (existing) {
      const contentChanged =
        existing.kind !== kind ||
        existing.before !== diff.before ||
        existing.after !== diff.after ||
        existing.compatibility !== classified.compatibility;
      const shouldInvalidate =
        existing.reviewState !== 'pending' && (diff.invalidating || contentChanged);
      if (!contentChanged && !shouldInvalidate) continue;
      mutated = true;
      changes = changes.map((change) => {
        if (change.id !== id) return change;
        const next: ContractChange = {
          ...change,
          kind,
          before: diff.before,
          after: diff.after,
          compatibility: classified.compatibility,
          rationale: classified.rationale,
          path: `${model.name}.${diff.field}`,
          source,
        };
        if (shouldInvalidate) {
          invalidated += 1;
          next.reviewState = 'pending';
          next.invalidation = {
            reason: `共享模型 ${model.name} ${diff.summary}，原评审结论失效`,
            at: now,
            previousState: change.reviewState,
            previousReviewer: change.reviewer,
            previousComment: change.reviewComment,
          };
          next.reviewer = '';
          next.reviewComment = '';
          next.reviewedAt = undefined;
        }
        return next;
      });
    } else {
      mutated = true;
      added += 1;
      changes.push({
        id,
        path: `${model.name}.${diff.field}`,
        method: 'SCHEMA',
        kind,
        before: diff.before,
        after: diff.after,
        compatibility: classified.compatibility,
        rationale: classified.rationale,
        impactStatement: '',
        migrationPlan: '',
        reviewState: 'pending',
        reviewer: '',
        reviewComment: '',
        source,
      });
    }
  }

  if (!mutated) {
    return { contract, changed: false, added: 0, removed: 0, invalidated: 0 };
  }

  // 出现失效或新的不兼容派生变更时，待发布状态回退为评审中
  const hasBreakingWork =
    invalidated > 0 ||
    changes.some(
      (change) =>
        change.source?.modelId === model.id &&
        change.reviewState === 'pending' &&
        change.compatibility === 'breaking',
    );
  const status =
    contract.status === 'ready' && hasBreakingWork ? ('review' as const) : contract.status;

  return {
    contract: { ...contract, changes, status },
    changed: true,
    added,
    removed,
    invalidated,
  };
}

/** 将共享模型渲染为 OpenAPI schema 片段 */
export function renderSharedModelSchema(model: SharedModel): string {
  const properties = model.fields
    .map(
      (field) =>
        `        ${field.name}: { type: ${field.type}${field.required ? ', required: true' : ''}${
          field.enumValues.length ? `, enum: [${field.enumValues.join(', ')}]` : ''
        } }`,
    )
    .join('\n');
  return [`    ${model.name}:`, '      type: object', '      properties:', properties]
    .filter(Boolean)
    .join('\n');
}

/** 生效定义 = 契约内联定义 + 引用模型解析结果；冻结快照使用该结果，之后模型变化不会改写快照 */
export function resolveContractOpenApi(contract: ApiContract, models: SharedModel[]): string {
  const referenced = contract.modelRefs
    .map((ref) => models.find((model) => model.id === ref.modelId))
    .filter((model): model is SharedModel => Boolean(model));
  if (!referenced.length) return contract.openapi;
  const block = [
    '# ---- 引用共享模型（自动解析，请勿手改） ----',
    'components:',
    '  schemas:',
    ...referenced.map(renderSharedModelSchema),
  ].join('\n');
  return `${contract.openapi.trimEnd()}\n\n${block}\n`;
}
