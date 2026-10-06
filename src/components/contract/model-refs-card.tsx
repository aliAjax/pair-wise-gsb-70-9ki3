import { Link2, Link2Off, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import type { ApiContract } from '../../models/contract';
import { renderSharedModelSchema, type SharedModel } from '../../models/shared-model';

interface ModelRefsCardProps {
  contract: ApiContract;
  models: SharedModel[];
  onSetRefs: (modelIds: string[]) => void;
  saving: boolean;
}

/**
 * 契约的共享模型引用管理。引用后契约生效定义 = 内联定义 + 模型解析结果；
 * 模型保存时会按引用关系重算本契约的派生变更。
 */
export function ModelRefsCard({ contract, models, onSetRefs, saving }: ModelRefsCardProps) {
  const [candidate, setCandidate] = useState('');
  const frozen = contract.status === 'frozen';
  const referencedIds = new Set(contract.modelRefs.map((ref) => ref.modelId));
  const referenced = contract.modelRefs
    .map((ref) => models.find((model) => model.id === ref.modelId))
    .filter((model): model is SharedModel => Boolean(model));
  const available = models.filter((model) => !referencedIds.has(model.id));

  function attach() {
    if (!candidate) return;
    onSetRefs([...contract.modelRefs.map((ref) => ref.modelId), candidate]);
    setCandidate('');
  }

  function detach(modelId: string) {
    onSetRefs(contract.modelRefs.map((ref) => ref.modelId).filter((id) => id !== modelId));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>共享模型引用</CardTitle>
        <p className="mt-1 text-xs text-slate-500">
          引用共享模型替代逐份复制的字段定义，模型保存后自动重算本契约
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {contract.modelRefs.map((ref) => {
          const model = models.find((item) => item.id === ref.modelId);
          return (
            <div
              key={ref.modelId}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Link2 className="h-3.5 w-3.5 text-sky-800" />
                  <strong className="text-sm">{ref.modelName}</strong>
                  {model && <Badge tone="neutral">修订 #{model.revision}</Badge>}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {model ? `${model.fields.length} 个字段 · ${model.owner}` : '模型不存在'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={saving || frozen}
                onClick={() => detach(ref.modelId)}
              >
                <Link2Off className="h-3.5 w-3.5" />
                移除
              </Button>
            </div>
          );
        })}
        {!contract.modelRefs.length && (
          <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
            尚未引用共享模型，当前完全使用内联定义。
          </p>
        )}

        {!frozen && available.length > 0 && (
          <div className="flex gap-2">
            <Select value={candidate} onValueChange={setCandidate}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="选择要引用的模型" />
              </SelectTrigger>
              <SelectContent>
                {available.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name} · {model.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              size="sm"
              disabled={!candidate || saving}
              onClick={attach}
            >
              <Plus className="h-3.5 w-3.5" />
              引用
            </Button>
          </div>
        )}
        {frozen && (
          <p className="text-[11px] text-slate-500">契约已冻结，引用关系不可调整。</p>
        )}

        {referenced.length > 0 && (
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              引用模型解析结果（只读）
            </span>
            <pre className="mt-1.5 max-h-56 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
              {referenced.map(renderSharedModelSchema).join('\n')}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
