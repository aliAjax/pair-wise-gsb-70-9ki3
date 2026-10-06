import { Boxes, Plus, RefreshCw, Save, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConflictDialog } from '../components/contract/conflict-dialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { formatDateTime } from '../lib/utils';
import { CONTRACT_STATUS_LABELS } from '../models/contract';
import {
  MODEL_FIELD_TYPES,
  type ModelField,
  type SharedModel,
} from '../models/shared-model';
import {
  useContracts,
  useSaveSharedModel,
  useSharedModels,
} from '../services/contract-queries';
import type { ModelRecomputeSummary } from '../services/model-service';
import { getConflict } from '../services/storage';

export function ModelsPage() {
  const modelsQuery = useSharedModels();
  const contractsQuery = useContracts();
  const saveModel = useSaveSharedModel();
  const [selectedId, setSelectedId] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<SharedModel | null>(null);
  const [baseRevision, setBaseRevision] = useState(0);
  const [conflict, setConflict] = useState<SharedModel | null>(null);
  const [summary, setSummary] = useState<ModelRecomputeSummary[] | null>(null);

  const models = modelsQuery.data ?? [];
  const contracts = contractsQuery.data;
  const selected = isNew ? undefined : (models.find((model) => model.id === selectedId) ?? models[0]);
  const selectedKey = isNew ? selectedId : (selected?.id ?? '');

  // 切换模型时加载草稿；同一模型的外部更新不覆盖本地草稿
  useEffect(() => {
    if (isNew) return;
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft(structuredClone(selected));
    setBaseRevision(selected.revision);
    setConflict(null);
    setSummary(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, isNew]);

  const bindings = useMemo(() => {
    if (!selected) return [];
    return (contracts ?? []).flatMap((contract) =>
      contract.modelRefs
        .filter((binding) => binding.modelId === selected.id)
        .map((binding) => ({ contract, binding })),
    );
  }, [contracts, selected]);

  const dirty =
    !!draft &&
    (isNew ||
      !selected ||
      JSON.stringify({ ...draft, version: 0, revision: 0, updatedAt: '' }) !==
        JSON.stringify({ ...selected, version: 0, revision: 0, updatedAt: '' }));
  const externallyUpdated = !!selected && !isNew && selected.revision !== baseRevision;

  function createDraft() {
    const fresh: SharedModel = {
      id: `model-${Date.now()}`,
      name: '新建共享模型',
      domain: '待分类',
      owner: '当前用户',
      version: 0,
      revision: 0,
      updatedAt: new Date().toISOString(),
      fields: [{ name: 'field1', type: 'string', required: false }],
    };
    setIsNew(true);
    setSelectedId(fresh.id);
    setDraft(fresh);
    setBaseRevision(0);
    setConflict(null);
    setSummary(null);
  }

  function selectModel(id: string) {
    setIsNew(false);
    setSelectedId(id);
  }

  function updateMeta(patch: Partial<SharedModel>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function updateField(index: number, patch: Partial<ModelField>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            fields: current.fields.map((field, itemIndex) =>
              itemIndex === index ? { ...field, ...patch } : field,
            ),
          }
        : current,
    );
  }

  function addField() {
    setDraft((current) =>
      current
        ? {
            ...current,
            fields: [
              ...current.fields,
              { name: `field${current.fields.length + 1}`, type: 'string', required: false },
            ],
          }
        : current,
    );
  }

  function removeField(index: number) {
    setDraft((current) =>
      current
        ? { ...current, fields: current.fields.filter((_, itemIndex) => itemIndex !== index) }
        : current,
    );
  }

  async function save(base: number) {
    if (!draft) return;
    try {
      const outcome = await saveModel.mutateAsync({ model: draft, baseRevision: base });
      setIsNew(false);
      setSelectedId(outcome.model.id);
      setDraft(structuredClone(outcome.model));
      setBaseRevision(outcome.model.revision);
      setSummary(outcome.affected);
      setConflict(null);
    } catch (error) {
      const info = getConflict<SharedModel>(error);
      if (!info) throw error;
      setConflict(info.stored);
    }
  }

  async function overwriteConflict() {
    if (!conflict) return;
    await save(conflict.revision);
  }

  function discardDraft() {
    if (!conflict) return;
    setIsNew(false);
    setSelectedId(conflict.id);
    setDraft(structuredClone(conflict));
    setBaseRevision(conflict.revision);
    setConflict(null);
  }

  return (
    <div>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
            Shared Models
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">共享模型</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            契约通过引用共享模型复用字段定义。保存模型时按引用关系重算受影响契约；删字段、改类型或加必填会使旧评审结论失效，需重新确认。
          </p>
        </div>
        <Button onClick={createDraft}>
          <Plus className="h-4 w-4" />
          新建模型
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>模型清单</CardTitle>
            <p className="mt-1 text-xs text-slate-500">{models.length} 个共享模型</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {modelsQuery.isLoading && (
              <p className="py-8 text-center text-sm text-slate-500">正在加载模型...</p>
            )}
            {isNew && (
              <div className="rounded-md border border-sky-300 bg-sky-50 p-3">
                <div className="text-sm font-medium text-sky-950">{draft?.name}</div>
                <div className="mt-1 text-xs text-sky-800">未保存的新模型</div>
              </div>
            )}
            {models.map((model) => {
              const boundContracts = (contracts ?? []).filter((contract) =>
                contract.modelRefs.some((binding) => binding.modelId === model.id),
              ).length;
              const active = !isNew && selected?.id === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => selectModel(model.id)}
                  className={
                    active
                      ? 'w-full rounded-md border border-sky-300 bg-sky-50 p-3 text-left'
                      : 'w-full rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50'
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{model.name}</strong>
                    <Badge tone="neutral">v{model.version}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {model.fields.length} 个字段 · {boundContracts} 个契约引用
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    更新 {formatDateTime(model.updatedAt)}
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {summary && (
            <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs leading-6 text-sky-950">
              <div className="flex items-center justify-between gap-2">
                <strong className="flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" />
                  已按引用关系重算 {summary.length} 个契约
                </strong>
                <button
                  type="button"
                  className="text-sky-700 hover:text-sky-950"
                  onClick={() => setSummary(null)}
                >
                  收起
                </button>
              </div>
              <ul className="mt-1 list-disc pl-5">
                {summary.map((item) => (
                  <li key={item.contractId}>
                    {item.contractName}：
                    {item.skippedFrozen
                      ? '已冻结，跳过重算，模型变化不会改写冻结契约'
                      : `新增 ${item.created} 项差异，${item.invalidated} 条评审结论失效待重新确认，撤销 ${item.removed} 项`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {externallyUpdated && !conflict && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-amber-900">
                <TriangleAlert className="h-4 w-4" />
                其他窗口已保存此模型的新版本（v{selected?.version}），你的草稿基于旧版本。
              </span>
              <Button size="sm" variant="outline" onClick={() => selected && setConflict(selected)}>
                查看对方改动
              </Button>
            </div>
          )}

          {draft ? (
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-sky-800" />
                    模型定义
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    {isNew ? '保存后创建模型并可被契约引用' : `当前版本 v${draft.version}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={!dirty || saveModel.isPending}
                  onClick={() => void save(baseRevision)}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saveModel.isPending ? '保存中' : '保存模型'}
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      模型名称
                    </label>
                    <Input
                      value={draft.name}
                      onChange={(event) => updateMeta({ name: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">领域</label>
                    <Input
                      value={draft.domain}
                      onChange={(event) => updateMeta({ domain: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      负责人
                    </label>
                    <Input
                      value={draft.owner}
                      onChange={(event) => updateMeta({ owner: event.target.value })}
                    />
                  </div>
                </div>

                <div className="mt-5">
                  <div className="mb-2 grid grid-cols-[1fr_130px_90px_36px] items-center gap-2 text-[11px] font-medium text-slate-500">
                    <span>字段名</span>
                    <span>类型</span>
                    <span>必填</span>
                    <span />
                  </div>
                  <div className="space-y-2">
                    {draft.fields.map((field, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[1fr_130px_90px_36px] items-center gap-2"
                      >
                        <Input
                          value={field.name}
                          onChange={(event) => updateField(index, { name: event.target.value })}
                          placeholder="字段名"
                        />
                        <Select
                          value={field.type}
                          onValueChange={(value) => updateField(index, { type: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MODEL_FIELD_TYPES.map((type) => (
                              <SelectItem key={type} value={type}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <label className="flex items-center gap-2 text-xs text-slate-600">
                          <Checkbox
                            checked={field.required}
                            onCheckedChange={(checked) =>
                              updateField(index, { required: checked === true })
                            }
                            aria-label={`字段 ${field.name} 是否必填`}
                          />
                          必填
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeField(index)}
                          aria-label={`删除字段 ${field.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button className="mt-3" variant="secondary" size="sm" onClick={addField}>
                    <Plus className="h-3.5 w-3.5" />
                    添加字段
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-14 text-center text-sm text-slate-500">
                选择左侧模型或新建一个共享模型。
              </CardContent>
            </Card>
          )}

          {!isNew && selected && (
            <Card>
              <CardHeader>
                <CardTitle>引用此模型的契约</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  保存模型时按以下绑定关系重算契约差异与评审结论
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {bindings.map(({ contract, binding }) => (
                  <div
                    key={`${contract.id}-${binding.path}-${binding.method}`}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <div className="text-sm font-medium">{contract.name}</div>
                      <div className="mt-1 font-mono text-[11px] text-slate-500">
                        {binding.method} {binding.path}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">同步至 v{binding.modelVersion}</Badge>
                      {contract.status === 'frozen' ? (
                        <Badge tone="slate">已冻结，模型变化不会改写</Badge>
                      ) : (
                        <Badge tone="blue">{CONTRACT_STATUS_LABELS[contract.status]}</Badge>
                      )}
                    </div>
                  </div>
                ))}
                {!bindings.length && (
                  <p className="py-6 text-center text-sm text-slate-500">
                    暂无契约引用此模型。
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ConflictDialog
        open={!!conflict}
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
        title="共享模型已被其他窗口修改"
        description="你的草稿已保留。覆盖保存将以你的草稿重算所有引用契约；放弃草稿则加载对方版本。"
        original={conflict ? modelProjection(conflict) : ''}
        modified={draft ? modelProjection(draft) : ''}
        saving={saveModel.isPending}
        onOverwrite={() => void overwriteConflict()}
        onDiscard={discardDraft}
      />
    </div>
  );
}

function modelProjection(model: SharedModel): string {
  return JSON.stringify(
    {
      name: model.name,
      domain: model.domain,
      owner: model.owner,
      version: model.version,
      fields: model.fields,
    },
    null,
    2,
  );
}
