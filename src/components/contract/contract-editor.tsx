import Editor from '@monaco-editor/react';
import { Save } from 'lucide-react';
import { Button } from '../ui/button';

interface ContractEditorProps {
  /** 本地草稿内容，由父组件持有以在冲突时保留 */
  value: string;
  /** 存储中的内容，用于判断是否有未保存修改 */
  storedValue: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
}

export function ContractEditor({ value, storedValue, onChange, onSave, saving }: ContractEditorProps) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <span className="text-xs font-medium text-slate-700">OpenAPI 源定义</span>
          <span className="ml-2 text-[11px] text-slate-500">Monaco Editor</span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={saving || value === storedValue}
          onClick={onSave}
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? '保存中' : '保存定义'}
        </Button>
      </div>
      <Editor
        height="430px"
        language="plaintext"
        theme="vs"
        value={value}
        onChange={(nextValue) => onChange(nextValue ?? '')}
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
    </div>
  );
}
