import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { router } from './router';
import { contractKeys, modelKeys } from './services/contract-queries';
import { CONTRACTS_STORAGE_KEY, MODELS_STORAGE_KEY } from './services/storage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// 其他窗口写入 localStorage 时刷新本地缓存，让对方的改动及时可见
window.addEventListener('storage', (event) => {
  if (event.key === CONTRACTS_STORAGE_KEY) {
    void queryClient.invalidateQueries({ queryKey: contractKeys.all });
  }
  if (event.key === MODELS_STORAGE_KEY) {
    void queryClient.invalidateQueries({ queryKey: modelKeys.all });
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
