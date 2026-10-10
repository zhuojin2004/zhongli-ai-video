import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./app";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // 1 分钟内复用缓存，不重复请求
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={process.env.CLIENT_BASE_PATH || "/"}>
        <div className="min-h-screen bg-background">
          <ErrorBoundary
            fallbackRender={({ error, resetErrorBoundary }) => (
              <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
                <h1 className="text-xl font-bold text-destructive">页面出错</h1>
                <pre className="text-sm text-muted-foreground bg-muted p-4 rounded-lg max-w-xl overflow-x-auto">
                  {error?.message || String(error)}
                </pre>
                <button
                  onClick={resetErrorBoundary}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
                >
                  重试
                </button>
              </div>
            )}
          >
            <App />
          </ErrorBoundary>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
