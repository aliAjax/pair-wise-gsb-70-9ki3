import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SharedModel } from '../models/shared-model';
import { getSharedModel, listSharedModels, saveSharedModel } from './shared-model-service';
import { contractKeys } from './contract-queries';

export const modelKeys = {
  all: ['shared-models'] as const,
  detail: (id: string) => ['shared-models', id] as const,
};

export function useSharedModels() {
  return useQuery({
    queryKey: modelKeys.all,
    queryFn: listSharedModels,
  });
}

export function useSharedModel(id: string) {
  return useQuery({
    queryKey: modelKeys.detail(id),
    queryFn: () => getSharedModel(id),
    enabled: Boolean(id),
  });
}

export function useSaveSharedModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { model: SharedModel; expectedRevision?: number }) =>
      saveSharedModel(input.model, { expectedRevision: input.expectedRevision }),
    onSuccess: () => {
      // 保存模型会按引用关系重算契约，两个缓存都需要刷新
      void queryClient.invalidateQueries({ queryKey: modelKeys.all });
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
}
