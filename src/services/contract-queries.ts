import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ApiContract, ContractChange, ReviewState } from '../models/contract';
import {
  addExemption,
  bulkReviewChanges,
  freezeVersion,
  getContract,
  listContracts,
  patchContractChange,
  reviewChange,
  saveContract,
  setContractModelRefs,
  updateContractOpenApi,
} from './contract-service';
import { CONTRACTS_KEY, MODELS_KEY } from './storage';

export const contractKeys = {
  all: ['contracts'] as const,
  detail: (id: string) => ['contracts', id] as const,
};

export function useContracts() {
  return useQuery({
    queryKey: contractKeys.all,
    queryFn: listContracts,
  });
}

export function useContract(id: string) {
  return useQuery({
    queryKey: contractKeys.detail(id),
    queryFn: () => getContract(id),
    enabled: Boolean(id),
  });
}

export function useReviewChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      contractId: string;
      changeId: string;
      state: ReviewState;
      reviewer: string;
      comment: string;
    }) =>
      reviewChange(
        input.contractId,
        input.changeId,
        input.state,
        input.reviewer,
        input.comment,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useBulkReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      selections: Array<{ contractId: string; changeId: string }>;
      state: ReviewState;
      reviewer: string;
      comment: string;
    }) =>
      bulkReviewChanges(
        input.selections,
        input.state,
        input.reviewer,
        input.comment,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useUpdateOpenApi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string; openapi: string; expectedRevision?: number }) =>
      updateContractOpenApi(input.contractId, input.openapi, {
        expectedRevision: input.expectedRevision,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useSaveContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contract: ApiContract) => saveContract(contract),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function usePatchContractChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string; changeId: string; patch: Partial<ContractChange> }) =>
      patchContractChange(input.contractId, input.changeId, input.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useSetContractModelRefs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string; modelIds: string[] }) =>
      setContractModelRefs(input.contractId, input.modelIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useAddExemption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string; changeId: string; reason: string }) =>
      addExemption(input.contractId, input.changeId, input.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useFreezeVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string; version: string; notes: string }) =>
      freezeVersion(input.contractId, input.version, input.notes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

/**
 * 跨窗口同步：其他窗口写入 localStorage 后触发 storage 事件，
 * 本窗口作废查询缓存以展示对方改动；编辑器草稿由组件自行保留。
 */
export function useCrossWindowSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === CONTRACTS_KEY) {
        void queryClient.invalidateQueries({ queryKey: contractKeys.all });
      }
      if (event.key === MODELS_KEY) {
        void queryClient.invalidateQueries({ queryKey: ['shared-models'] });
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [queryClient]);
}
