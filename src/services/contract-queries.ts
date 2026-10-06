import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContractChange, ReviewState } from '../models/contract';
import type { SharedModel } from '../models/shared-model';
import {
  addExemption,
  bulkReviewChanges,
  freezeVersion,
  getContract,
  listContracts,
  reviewChange,
  saveContract,
  updateChangeFields,
  updateContractOpenApi,
} from './contract-service';
import { listSharedModels, saveSharedModel } from './model-service';

export const contractKeys = {
  all: ['contracts'] as const,
  detail: (id: string) => ['contracts', id] as const,
};

export const modelKeys = {
  all: ['shared-models'] as const,
  detail: (id: string) => ['shared-models', id] as const,
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

export function useSharedModels() {
  return useQuery({
    queryKey: modelKeys.all,
    queryFn: listSharedModels,
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
    mutationFn: (input: { contractId: string; openapi: string; baseRevision?: number }) =>
      updateContractOpenApi(input.contractId, input.openapi, input.baseRevision),
    onSuccess: (updated) => {
      queryClient.setQueryData(contractKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
}

export function useUpdateChangeFields() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string; changeId: string; patch: Partial<ContractChange> }) =>
      updateChangeFields(input.contractId, input.changeId, input.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useSaveContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contract: Parameters<typeof saveContract>[0]; baseRevision?: number }) =>
      saveContract(input.contract, input.baseRevision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useSaveSharedModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { model: SharedModel; baseRevision: number }) =>
      saveSharedModel(input.model, input.baseRevision),
    onSuccess: (outcome) => {
      queryClient.setQueryData<SharedModel[]>(modelKeys.all, (old) => {
        const list = old ?? [];
        return list.some((item) => item.id === outcome.model.id)
          ? list.map((item) => (item.id === outcome.model.id ? outcome.model : item))
          : [outcome.model, ...list];
      });
      void queryClient.invalidateQueries({ queryKey: modelKeys.all });
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
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
