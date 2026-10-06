import { DiffEditor } from '@monaco-editor/react';
import { GitCompareArrows } from 'lucide-react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

interface ConflictDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** 对方已保存的内容 */
  original: string;
  /** 本地草稿内容 */
  modified: string;
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  /** 用本地草稿覆盖对方版本 */
  onOverwrite: () => void;
  /** 放弃本地草稿，加载对方版本 */
  onDiscard: () => void;
}

export function ConflictDialog({
  open,
  title,
  description,
  original,
  modified,
  saving = false,
  onOpenChange,
  onOverwrite,
  onDiscard,
}: ConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(980px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-amber-600" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="mb-2 flex justify-between text-[11px] font-medium text-slate-500">
          <span>左：对方已保存版本</span>
          <span>右：我的草稿（已保留）</span>
        </div>
        <div className="overflow-hidden rounded-md border border-slate-200">
          <DiffEditor
            height="420px"
            language="plaintext"
            original={original}
            modified={modified}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              renderSideBySide: true,
              fontSize: 12,
              automaticLayout: true,
            }}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onDiscard}>
            放弃草稿，加载对方版本
          </Button>
          <Button onClick={onOverwrite} disabled={saving}>
            {saving ? '覆盖中' : '用我的草稿覆盖'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
