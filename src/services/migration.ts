import type { ApiContract } from '../models/contract';
import type { ModelBinding, ModelField } from '../models/shared-model';
import { fieldsSignature } from '../models/shared-model';
import { loadModelsRaw, persistModels } from './storage';

/** 旧数据缺少引用信息或版本号时需要迁移 */
export function needsMigration(contract: ApiContract): boolean {
  return typeof contract.revision !== 'number' || !Array.isArray(contract.modelRefs);
}

/**
 * 旧契约没有引用信息时，按内联 OpenAPI 定义迁移：
 * 解析每个操作的字段集合，生成（或按字段签名复用）共享模型并建立绑定。
 */
export function migrateLegacyContracts(contracts: ApiContract[]): ApiContract[] {
  const models = loadModelsRaw() ?? [];
  const now = new Date().toISOString();
  let created = 0;

  const migrated = contracts.map((contract) => {
    const next: ApiContract = {
      ...contract,
      revision: typeof contract.revision === 'number' ? contract.revision : 1,
      modelRefs: Array.isArray(contract.modelRefs) ? contract.modelRefs : [],
    };
    if (Array.isArray(contract.modelRefs)) return next;

    const refs: ModelBinding[] = [];
    for (const operation of parseInlineOperations(contract.openapi)) {
      if (!operation.fields.length) continue;
      const signature = fieldsSignature(operation.fields);
      let model = models.find((item) => fieldsSignature(item.fields) === signature);
      if (!model) {
        created += 1;
        model = {
          id: `model-legacy-${Date.now()}-${created}`,
          name: `${contract.name} ${operation.method} ${operation.path} 迁移模型`,
          domain: contract.domain,
          owner: contract.owner,
          version: 1,
          revision: 1,
          updatedAt: now,
          fields: operation.fields,
        };
        models.push(model);
      }
      refs.push({
        modelId: model.id,
        modelVersion: model.version,
        path: operation.path,
        method: operation.method,
      });
    }
    next.modelRefs = refs;
    return next;
  });

  persistModels(models);
  return migrated;
}

interface InlineOperation {
  path: string;
  method: string;
  fields: ModelField[];
}

/** 解析契约内联定义：优先按 JSON OpenAPI，其次按种子数据的 YAML 风格文本 */
export function parseInlineOperations(openapi: string): InlineOperation[] {
  const fromJson = parseJsonOperations(openapi);
  if (fromJson.length) return fromJson;
  return parseYamlLikeOperations(openapi);
}

function parseJsonOperations(openapi: string): InlineOperation[] {
  try {
    const parsed: unknown = JSON.parse(openapi);
    if (!parsed || typeof parsed !== 'object') return [];
    const paths = (parsed as { paths?: unknown }).paths;
    if (!paths || typeof paths !== 'object') return [];
    const operations: InlineOperation[] = [];
    for (const [path, methods] of Object.entries(paths)) {
      if (!methods || typeof methods !== 'object') continue;
      for (const [method, operation] of Object.entries(methods)) {
        const schema = digRequestSchema(operation);
        if (!schema) continue;
        const fields = Object.entries(schema.properties).map(([name, definition]) => ({
          name,
          type:
            definition && typeof definition === 'object'
              ? String((definition as { type?: unknown }).type ?? 'string')
              : 'string',
          required: schema.required.includes(name),
        }));
        if (fields.length) {
          operations.push({ path, method: method.toUpperCase(), fields });
        }
      }
    }
    return operations;
  } catch {
    return [];
  }
}

function digRequestSchema(
  operation: unknown,
): { properties: Record<string, unknown>; required: string[] } | null {
  if (!operation || typeof operation !== 'object') return null;
  const requestBody = (operation as { requestBody?: unknown }).requestBody;
  if (!requestBody || typeof requestBody !== 'object') return null;
  const content = (requestBody as { content?: unknown }).content;
  if (!content || typeof content !== 'object') return null;
  const json = (content as Record<string, unknown>)['application/json'];
  if (!json || typeof json !== 'object') return null;
  const schema = (json as { schema?: unknown }).schema;
  if (!schema || typeof schema !== 'object') return null;
  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== 'object') return null;
  const requiredRaw = (schema as { required?: unknown }).required;
  return {
    properties: properties as Record<string, unknown>,
    required: Array.isArray(requiredRaw) ? requiredRaw.map(String) : [],
  };
}

function parseYamlLikeOperations(openapi: string): InlineOperation[] {
  const operations: InlineOperation[] = [];
  const index = new Map<string, InlineOperation>();
  let currentPath = '';
  let currentMethod = '';
  for (const line of openapi.split('\n')) {
    const pathMatch = /^ {4}(\/\S+):\s*$/.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1];
      currentMethod = '';
      continue;
    }
    const methodMatch = /^ {6}(get|post|put|delete|patch):\s*$/i.exec(line);
    if (methodMatch) {
      currentMethod = methodMatch[1].toUpperCase();
      continue;
    }
    const propertyMatch = /^\s+([A-Za-z_][\w]*):\s*\{\s*type:\s*"([^"]+)"\s*\}\s*,?\s*$/.exec(line);
    if (propertyMatch && currentPath && currentMethod) {
      const key = `${currentMethod} ${currentPath}`;
      let operation = index.get(key);
      if (!operation) {
        operation = { path: currentPath, method: currentMethod, fields: [] };
        index.set(key, operation);
        operations.push(operation);
      }
      operation.fields.push({
        name: propertyMatch[1],
        type: propertyMatch[2],
        required: false,
      });
    }
  }
  return operations;
}
