import { classifyChange, type ChangeKind, type Compatibility } from './contract';

export interface ModelField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface SharedModel {
  id: string;
  name: string;
  domain: string;
  owner: string;
  /** 每次保存递增，用于契约绑定的同步标记 */
  version: number;
  /** 每次保存递增，用于并发冲突检测 */
  revision: number;
  updatedAt: string;
  fields: ModelField[];
}

/** 契约对共享模型的引用，绑定到具体路径与方法 */
export interface ModelBinding {
  modelId: string;
  /** 契约最近一次重算时同步到的模型版本 */
  modelVersion: number;
  path: string;
  method: string;
}

/** 字段在某一时刻的定义快照，用于累积差异计算 */
export interface FieldSnapshot {
  type: string;
  required: boolean;
}

export const MODEL_FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];

export function snapshotOfField(field: ModelField | undefined): FieldSnapshot | null {
  if (!field) return null;
  return { type: field.type, required: field.required };
}

export function snapshotOfModel(
  model: SharedModel | undefined,
  fieldName: string,
): FieldSnapshot | null {
  return snapshotOfField(model?.fields.find((field) => field.name === fieldName));
}

export function sameSnapshot(left: FieldSnapshot | null, right: FieldSnapshot | null): boolean {
  if (!left || !right) return left === right;
  return left.type === right.type && left.required === right.required;
}

/** 两次模型保存之间发生定义变化（含新增、删除）的字段名 */
export function touchedFieldNames(previous: ModelField[], next: ModelField[]): string[] {
  const names = new Set([...previous.map((field) => field.name), ...next.map((field) => field.name)]);
  return Array.from(names).filter((name) => {
    const before = snapshotOfField(previous.find((field) => field.name === name));
    const after = snapshotOfField(next.find((field) => field.name === name));
    return !sameSnapshot(before, after);
  });
}

/** 字段集合签名，用于迁移时跨契约去重相同模型 */
export function fieldsSignature(fields: ModelField[]): string {
  return fields
    .map((field) => `${field.name}:${field.type}:${field.required ? '1' : '0'}`)
    .sort()
    .join('|');
}

export interface FieldDelta {
  kind: ChangeKind;
  before: string;
  after: string;
  compatibility: Compatibility;
  rationale: string;
}

/** 由字段原始快照与当前快照渲染一条契约差异 */
export function describeFieldDelta(
  fieldName: string,
  origin: FieldSnapshot | null,
  current: FieldSnapshot | null,
): FieldDelta {
  let kind: ChangeKind;
  let before: string;
  let after: string;
  if (!origin && current) {
    kind = 'field_added';
    before = `模型中不存在字段 ${fieldName}`;
    after = `新增${current.required ? '必填' : '可选'}字段 ${fieldName}: ${current.type}`;
  } else if (origin && !current) {
    kind = 'field_removed';
    before = `字段 ${fieldName}: ${origin.type}（${origin.required ? '必填' : '可选'}）`;
    after = `移除字段 ${fieldName}`;
  } else if (origin && current && origin.type !== current.type) {
    kind = 'type_changed';
    before = `字段 ${fieldName}: ${origin.type}`;
    after = `字段 ${fieldName} 类型变为 ${current.type}`;
  } else if (origin && current) {
    kind = 'optionality_changed';
    before = `${fieldName} 为${origin.required ? '必填' : '可选'}字段`;
    after = `${fieldName} 变为${current.required ? '必填' : '可选'}字段`;
  } else {
    throw new Error(`字段 ${fieldName} 没有变化，无需生成差异`);
  }
  const classified = classifyChange({ kind, before, after });
  return { kind, before, after, ...classified };
}
