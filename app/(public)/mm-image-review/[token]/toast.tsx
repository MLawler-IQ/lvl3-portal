'use client'

export type ToastState = {
  message: string
  err: boolean
} | null

export function Toast({ toast }: { toast: ToastState }) {
  return (
    <div
      className={`toast${toast ? ' show' : ''}${toast?.err ? ' err' : ''}`}
      role="status"
      aria-live="polite"
    >
      {toast?.message}
    </div>
  )
}
