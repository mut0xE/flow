"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: number;
  label: string;
  sig?: string;
  variant: ToastVariant;
  erExplorer?: boolean;
}

interface ToastCtx {
  addToast: (opts: { label: string; sig?: string; variant?: ToastVariant; erExplorer?: boolean }) => void;
}

const Ctx = createContext<ToastCtx>({ addToast: () => {} });

const L1_EXPLORER = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const ER_EXPLORER = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=https%3A%2F%2Fdevnet-as.magicblock.app%2F`;

let counter = 0;

export function TxToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    ({ label, sig, variant = "info", erExplorer = false }: { label: string; sig?: string; variant?: ToastVariant; erExplorer?: boolean }) => {
      const id = ++counter;
      setToasts((prev) => [...prev, { id, label, sig, variant, erExplorer }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
    },
    []
  );

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  return (
    <Ctx.Provider value={{ addToast }}>
      {children}
      {/* Toast tray — bottom right */}
      <div style={{
        position: "fixed", bottom: 20, right: 20, zIndex: 9999,
        display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end",
        pointerEvents: "none",
      }}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const borderColor =
    toast.variant === "success" ? "var(--green)" :
    toast.variant === "error" ? "var(--red)" : "var(--navy)";
  const textColor =
    toast.variant === "success" ? "var(--green)" :
    toast.variant === "error" ? "var(--red)" : "var(--text-bright)";
  const icon =
    toast.variant === "success" ? "✓" :
    toast.variant === "error" ? "✕" : "●";

  const explorerHref = toast.sig
    ? (toast.erExplorer ? ER_EXPLORER(toast.sig) : L1_EXPLORER(toast.sig))
    : null;

  return (
    <div
      style={{
        pointerEvents: "all",
        display: "flex", alignItems: "flex-start", gap: 8,
        border: `3px solid ${borderColor}`,
        background: "var(--win-bg)",
        boxShadow: `4px 4px 0 var(--navy)`,
        padding: "10px 12px",
        maxWidth: 340,
        animation: "risehud .15s ease-out both",
      }}
    >
      <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 9, color: textColor, marginTop: 1, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 9, color: "var(--text-bright)", lineHeight: 1.6 }}>
          {toast.label}
        </div>
        {explorerHref && toast.sig && (
          <a
            href={explorerHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontFamily: "'VT323', monospace", fontSize: 14, color: "#7fe6a0", textDecoration: "underline" }}
          >
            ↗ {toast.sig.slice(0, 8)}…{toast.sig.slice(-8)}
          </a>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          fontFamily: "'VT323', monospace", fontSize: 16, color: "var(--text-muted)",
          padding: 0, lineHeight: 1, flexShrink: 0,
        }}
      >✕</button>
    </div>
  );
}

export function useTxToast() {
  return useContext(Ctx);
}
