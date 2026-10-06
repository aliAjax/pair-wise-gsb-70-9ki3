import { Link } from '@tanstack/react-router';
import {
  CloudUpload,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { formatDateTime } from '../lib/utils';
import {
  MODEL_DIFF_KIND_LABELS,
  diffSharedModelFields,
  type SharedModel,
  type SharedModelField,
} from '../models/shared-model';
import { useContracts } from '../services/contract-queries';
import { isSaveConflict } from '../services/save-conflict';
import { useSaveSharedModel, useSharedModels } from '../services/shared-model-queries';
import type { ModelSaveResult } from '../services/shared-model-service';

const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'string[]', 'number[]', 'object'];

function emptyField(): SharedModelField {
  return { name: '', type: 'string', required: false, enumValues: [] };
}

function sameEditable(left: SharedModel, right: SharedModel): boolean {
  return (
    left.name === right.name &&
    left.domain === right.domain &&
    left.owner === right.owner &&
    left.description === right.description &&
    JSON.stringify(left.fields) === JSON.stringify(right.fields)
  );
}

export function ModelsPage() {
  const modelsQuery = useSharedModels();
  const contractsQuery = useContracts();
  const saveModel = useSaveSharedModel();
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<SharedModel | null>(null);
  const [base, setBase] = useState<SharedModel | null>(null);
  const [result, setResult] = useState<ModelSaveResult | null>(null);
  const [theirs, setTheirs] = useState<SharedModel | null>(null);
  const [error, setError] = useState('');

  const models = modelsQuery.data ?? [];
  const contracts = contractsQuery.data ?? [];
  const selected = models.find((model) => model.id === selectedId) ?? models[0];

  // 切换选中模型时以其最新内容初始化草稿
  if (selected && (!draft || !base || draft.id !== selected.id)) {
    setDraft(structuredClone(selected));
    setBase(selected);
    setResult(null);
    setTheirs(null);
    setError('');
  }

  const dirty = draft && base ? !sameEditable(draft, base) : false;
  const externalUpdated = selected && base && selected.revision > base.revision;
  const referencing = selected
    ? contracts.filter((contract) =>
        contract.modelRefs.some((ref) => ref.modelId === selected.id),
      )
    : [];
  const fieldNames = new Set(draft?.fields.map((field) => field.name).filter(Boolean));
  const duplicateName = draft ? fieldNames.size !== draft.fields.filter((f) => f.name).length : false;
  const missingName = draft?.fields.some((field) => !field.name.trim()) ?? false;
  const invalid = !draft?.name.trim() || duplicateName || missingName;

  async function save(expectedRevision: number) {
    if (!draft) return;
    setError('');
    try {
      const saved = await saveModel.mutateAsync({ model: draft, expectedRevision });
      setResult(saved);
      setBase(saved.model);
      setDraft(structuredClone(saved.model));
      setTheirs(null);
    } catch (cause) {
      if (isSaveConflict<SharedModel>(cause)) {
        // 后保存者：保留草稿，展示对方改动
        setTheirs(cause.stored);
      } else {
        setError(cause instanceof Error ? cause.message : '保存失败');
      }
    }
  }

  function adoptTheirs(latest: SharedModel) {
    setDraft(structuredClone(latest));
    setBase(latest);
    setTheirs(null);
    setResult(null);
  }

  function createModel() {
    const now = Date.now();
    const model: SharedModel = {
      id: `model-${now}`,
      name: `NewModel${models.length + 1}`,
      domain: '待分类',
      owner: '当前用户',
      description: '',
      fields: [{ name: 'id', type: 'string', required: true, enumValues: [] }],
      revision: 0,
      updatedAt: new Date().toISOString(),
    };
    void saveModel
      .mutateAsync({ model })
      .then((saved) => {
        setSelectedId(saved.model.id);
        setResult(saved);
      })
      .catch(() => setError('创建模型失败'));
  }

  function updateField(index: number, patch: Partial<SharedModelField>) {
    if (!draft) return;
    setDraft({
      ...draft,
      fields: draft.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    });
  }

  const theirDiffs =
    theirs && base ? diffSharedModelFields(base.fields, theirs.fields) : [];

  return (
    <div>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
            Shared Models
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">共享模型库</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            契约通过引用共享模型替代逐份复制的字段定义。保存模型时按引用关系重算受影响契约；
            删字段、改类型或加必填会使旧评审结论失效并需要重新确认。
          </p>
        </div>
        <Button onClick={createModel} disabled={saveModel.isPending}>
          <Plus className="h-4 w-4" />
          新建模型
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[300px_1fr_320px]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>模型清单</CardTitle>
            <p className="mt-1 text-xs text-slate-500">{models.length} 个共享模型</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {models.map((model) => {
              const refCount = contracts.filter((contract) =>
                contract.modelRefs.some((ref) => ref.modelId === model.id),
              ).length;
              const active = selected?.id === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  className={
                    active
                      ? 'w-full rounded-md border border-sky-300 bg-sky-50 p-3 text-left'
                      : 'w-full rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50'
                  }
                  onClick={() => setSelectedId(model.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{model.name}</strong>
                    <Badge tone="neutral">修订 #{model.revision}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {model.fields.length} 个字段 · {refCount} 个契约引用
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {formatDateTime(model.updatedAt)} 更新
                  </p>
                </button>
              );
            })}
            {modelsQuery.isLoading && (
              <p className="py-8 text-center text-sm text-slate-500">正在加载模型...</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>模型定义</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                {selected ? `${selected.domain} · 负责人 ${selected.owner}` : ''}
              </p>
            </div>
            <Button
              disabled={!dirty || invalid || saveModel.isPending || !base}
              onClick={() => base && void save(base.revision)}
            >
              <Save className="h-4 w-4" />
              {saveModel.isPending ? '保存并重算中' : '保存并重算引用契约'}
            </Button>
          </CardHeader>
          <CardContent>
            {externalUpdated && selected && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <CloudUpload className="h-3.5 w-3.5" />
                <span>
                  其他窗口已保存该模型（修订 #{selected.revision} ·{' '}
                  {formatDateTime(selected.updatedAt)}），你的草稿保持不变。
                </span>
                <button
                  type="button"
                  className="font-medium text-sky-800 hover:underline"
                  onClick={() => setTheirs(selected)}
                >
                  查看对方改动
                </button>
                {dirty && (
                  <button
                    type="button"
                    className="font-medium text-sky-800 hover:underline"
                    onClick={() => adoptTheirs(selected)}
                  >
                    放弃草稿并加载
                  </button>
                )}
              </div>
            )}
            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                <TriangleAlert className="h-3.5 w-3.5" />
                {error}
              </div>
            )}

            {draft && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium text-slate-700">模型名</label>
                    <Input
                      className="mt-1.5"
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700">领域</label>
                    <Input
                      className="mt-1.5"
                      value={draft.domain}
                      onChange={(event) => setDraft({ ...draft, domain: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700">负责人</label>
                    <Input
                      className="mt-1.5"
                      value={draft.owner}
                      onChange={(event) => setDraft({ ...draft, owner: event.target.value })}
                    />
                  </div>
                </div>
                <label className="mt-4 block text-xs font-medium text-slate-700">说明</label>
                <Textarea
                  className="mt-1.5 min-h-16"
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="模型的用途与维护约定"
                />

                <div className="mt-5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">
                    字段（{draft.fields.length}）
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDraft({ ...draft, fields: [...draft.fields, emptyField()] })}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加字段
                  </Button>
                </div>
                {duplicateName && (
                  <p className="mt-2 text-xs text-red-700">字段名不能重复。</p>
                )}
                {missingName && <p className="mt-2 text-xs text-red-700">字段名不能为空。</p>}

                <div className="mt-3 space-y-2">
                  {draft.fields.map((field, index) => (
                    <div
                      key={index}
                      className="grid items-center gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[1fr_130px_90px_1fr_36px]"
                    >
                      <Input
                        value={field.name}
                        placeholder="字段名"
                        onChange={(event) => updateField(index, { name: event.target.value.trim() })}
                      />
                      <Select
                        value={field.type}
                        onValueChange={(value) => updateField(index, { type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        <Checkbox
                          checked={field.required}
                          onCheckedChange={(checked) =>
                            updateField(index, { required: checked === true })
                          }
                          aria-label={`${field.name || '字段'} 是否必填`}
                        />
                        必填
                      </label>
                      <Input
                        value={field.enumValues.join(', ')}
                        placeholder="枚举值，逗号分隔"
                        onChange={(event) =>
                          updateField(index, {
                            enumValues: event.target.value
                              .split(',')
                              .map((value) => value.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`删除字段 ${field.name || index + 1}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            fields: draft.fields.filter((_, i) => i !== index),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {result && (
              <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs leading-6 text-emerald-900">
                <div className="flex items-center gap-2 font-medium">
                  <RefreshCcw className="h-3.5 w-3.5" />
                  已保存（修订 #{result.model.revision}），重算 {result.affected.length} 个引用契约
                </div>
                {result.diffs.length > 0 && (
                  <ul className="mt-1 list-inside list-disc">
                    {result.diffs.map((diff) => (
                      <li key={`${diff.field}-${diff.kind}`}>
                        {MODEL_DIFF_KIND_LABELS[diff.kind]}：{diff.summary}
                        {diff.invalidating && '（已使旧评审结论失效）'}
                      </li>
                    ))}
                  </ul>
                )}
                {!result.diffs.length && <p className="mt-1">字段定义无变化，未触发重算。</p>}
                {result.affected.map((item) => (
                  <p key={item.contractId} className="mt-1">
                    <Link
                      to="/contracts/$contractId"
                      params={{ contractId: item.contractId }}
                      className="font-medium text-sky-900 hover:underline"
                    >
                      {item.contractName}
                    </Link>
                    ：新增 {item.added} 项变更，抵消 {item.removed} 项，
                    {item.invalidated} 条评审结论失效
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>引用该模型的契约</CardTitle>
              <p className="mt-1 text-xs text-slate-500">保存模型时按引用关系重算</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {referencing.map((contract) => (
                <Link
                  key={contract.id}
                  to="/contracts/$contractId"
                  params={{ contractId: contract.id }}
                  className="block rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{contract.name}</strong>
                    <Badge tone={contract.status === 'frozen' ? 'slate' : 'neutral'}>
                      {contract.status === 'frozen' ? '已冻结' : `v${contract.version}`}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {contract.domain} · 修订 #{contract.revision}
                  </p>
                </Link>
              ))}
              {!referencing.length && (
                <p className="py-6 text-center text-xs text-slate-500">
                  暂无契约引用该模型，可在契约详情页添加引用。
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>失效规则</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs leading-5 text-slate-600">
              <p>删除字段、修改类型、改为必填：引用契约上的旧评审结论失效，需重新确认。</p>
              <p>新增可选字段、改为可选、枚举扩展：生成新变更但不使既有结论失效。</p>
              <p>冻结契约与已冻结版本快照不会被模型变化改写。</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!theirs} onOpenChange={(open) => !open && setTheirs(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存冲突：其他窗口已更新该模型</DialogTitle>
            <DialogDescription>
              {theirs &&
                `对方保存于 ${formatDateTime(theirs.updatedAt)}（修订 #${theirs.revision}）。你的草稿未被覆盖，对方改动如下。`}
            </DialogDescription>
          </DialogHeader>
          {theirs && (
            <>
              {theirDiffs.length > 0 ? (
                <ul className="space-y-2">
                  {theirDiffs.map((diff) => (
                    <li
                      key={`${diff.field}-${diff.kind}`}
                      className="rounded-md border border-slate-200 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Badge tone={diff.invalidating ? 'red' : 'neutral'}>
                          {MODEL_DIFF_KIND_LABELS[diff.kind]}
                        </Badge>
                        <span className="font-medium">{diff.summary}</span>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-slate-500">
                        {diff.before} → {diff.after}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">对方未修改字段定义（仅更新描述信息）。</p>
              )}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => adoptTheirs(theirs)}>
                  放弃草稿，加载对方版本
                </Button>
                <Button
                  onClick={() => void save(theirs.revision)}
                  disabled={saveModel.isPending}
                >
                  保留草稿，强制覆盖
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
