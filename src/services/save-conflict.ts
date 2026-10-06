/**
 * 乐观并发冲突：保存时发现存储中的修订号已领先于编辑基线，
 * 说明其他窗口已保存更新。调用方应保留本地草稿并展示对方改动。
 */
export class SaveConflictError<T> extends Error {
  readonly entity: 'contract' | 'model';
  readonly stored: T;

  constructor(entity: 'contract' | 'model', stored: T) {
    super('保存冲突：其他窗口已保存更新的版本');
    this.name = 'SaveConflictError';
    this.entity = entity;
    this.stored = stored;
  }
}

export function isSaveConflict<T>(error: unknown): error is SaveConflictError<T> {
  return error instanceof SaveConflictError;
}
