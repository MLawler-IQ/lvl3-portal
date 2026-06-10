"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Check, AlertCircle } from "lucide-react";
import { statusColor } from "@/lib/status-color";

type ToastVariant = "success" | "error";

interface ToastOptions {
  /** Optional undo handler — renders an "Undo" action on the toast. */
  onUndo?: () => void;
  /** Auto-dismiss delay in ms (default 3000). */
  duration?: number;
}

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  onUndo?: () => void;
  duration: number;
}

interface ToastContextValue {
  toast: (
    message: string,
    variant?: ToastVariant,
    options?: ToastOptions
  ) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}

function ToastView({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(item.id), item.duration);
    return () => clearTimeout(t);
  }, [item.id, item.duration, onDismiss]);

  const Icon = item.variant === "error" ? AlertCircle : Check;

  return (
    <div
      role="status"
      className="flex items-center gap-3 bg-surface-900/95 border border-surface-700 rounded-xl px-4 py-3 shadow-xl animate-slide-in-up whitespace-nowrap pointer-events-auto"
    >
      <Icon
        size={14}
        className="shrink-0"
        style={{ color: statusColor(item.variant) }}
      />
      <span className="text-sm text-surface-200">{item.message}</span>
      {item.onUndo && (
        <button
          onClick={() => {
            item.onUndo?.();
            onDismiss(item.id);
          }}
          className="text-sm text-surface-400 hover:text-surface-100 underline underline-offset-2 transition-colors"
        >
          Undo
        </button>
      )}
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (
      message: string,
      variant: ToastVariant = "success",
      options?: ToastOptions
    ) => {
      const id = ++idRef.current;
      setToasts((prev) => [
        ...prev,
        {
          id,
          message,
          variant,
          onUndo: options?.onUndo,
          duration: options?.duration ?? 3000,
        },
      ]);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-[60] flex flex-col items-end gap-2 pointer-events-none">
          {toasts.map((t) => (
            <ToastView key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
