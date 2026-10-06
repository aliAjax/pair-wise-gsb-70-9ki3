import Editor, { DiffEditor } from '@monaco-editor/react';
import { CloudUpload, Save, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { formatDateTime } from '../../lib/utils';
import type { ApiContract } from '../../models/contract';
import { isSaveConflict } from '../../services/save-conflict';

interface ContractEditorProps {
  contract: ApiContract;
  saveOpenApi: (input: {
    openapi: string;
    expectedRevision?: number;
  }) => Promise<ApiContract>;
  saving: boolean;
}

/**
 * OpenAPI 编辑器。草稿保存在本地 state，不因其他窗口保存而被覆盖；
 * 保存时携带编辑基线修订号，冲突后保留草稿并展示对方改动。
 */
export function ContractEditor({ contract, saveOpenApi, saving }: ContractEditorProps) {
  const [draft, setDraft] = useState(contract.openapi);
  const [baseRevision, setBaseRevision] = useState(contract.revision);
  const [baseOpenapi, setBaseOpenapi] = useState(contract.openapi);
  const [theirs, setTheirs] = useState<ApiContract | null>(null);
  const [error, setError] = useState('');

  // 存储修订号领先于编辑基线时，说明其他窗口已保存；自己的保存会立即推进基线，不触发横幅
  const externalUpdated = contract.revision > baseRevision;
  const dirty = draft !== baseOpenapi;

  async function save(expectedRevision: number) {
    setError('');
    try {
      const saved = await saveOpenApi({ openapi: draft, expectedRevision });
      setBaseRevision(saved.revision);
      setBaseOpenapi(saved.openapi);
      setTheirs(null);
    } catch (cause) {
      if (isSaveConflict<ApiContract>(cause)) {
        // 后保存者：保留草稿，展示对方改动
        setTheirs(cause.stored);
      } else {
        setError(cause instanceof Error ? cause.message : '保存失败');
      }
    }
  }

  function adoptTheirs(latest: ApiContract) {
    setDraft(latest.openapi);
    setBaseRevision(latest.revision);
    setBaseOpenapi(latest.openapi);
    setTheirs(null);
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <span className="text-xs font-medium text-slate-700">OpenAPI 源定义</span>
          <span className="ml-2 text-[11px] text-slate-500">
            内联定义 · 修订 #{baseRevision}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={saving || !dirty}
          onClick={() => void save(baseRevision)}
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? '保存中' : '保存定义'}
        </Button>
      </div>

      {externalUpdated && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <CloudUpload className="h-3.5 w-3.5" />
          <span>
            其他窗口已保存新版本（修订 #{contract.revision} ·{' '}
            {formatDateTime(contract.updatedAt)}），你的草稿保持不变。
          </span>
          <button
            type="button"
            className="font-medium text-sky-800 hover:underline"
            onClick={() => setTheirs(contract)}
          >
            查看对方改动
          </button>
          {dirty && (
            <button
              type="button"
              className="font-medium text-sky-800 hover:underline"
              onClick={() => adoptTheirs(contract)}
            >
              放弃草稿并加载
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <TriangleAlert className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      <Editor
        height="430px"
        language="plaintext"
        theme="vs"
        value={draft}
        onChange={(nextValue) => setDraft(nextValue ?? '')}
        options={{
          minimap: { enabled: false },
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
        }}
      />

      <Dialog open={!!theirs} onOpenChange={(open) => !open && setTheirs(null)}>
        <DialogContent className="w-[min(980px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>保存冲突：其他窗口已更新该契约</DialogTitle>
            <DialogDescription>
              {theirs &&
                `对方保存于 ${formatDateTime(theirs.updatedAt)}（修订 #${theirs.revision}）。左侧为对方最新定义，右侧为你的草稿，草稿未被覆盖。`}
            </DialogDescription>
          </DialogHeader>
          {theirs && (
            <>
              <div className="overflow-hidden rounded-md border border-slate-200">
                <DiffEditor
                  height="360px"
                  language="plaintext"
                  original={theirs.openapi}
                  modified={draft}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    renderSideBySide: true,
                    fontSize: 12,
                    automaticLayout: true,
                  }}
                />
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => adoptTheirs(theirs)}>
                  放弃草稿，加载对方版本
                </Button>
                <Button onClick={() => void save(theirs.revision)} disabled={saving}>
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
