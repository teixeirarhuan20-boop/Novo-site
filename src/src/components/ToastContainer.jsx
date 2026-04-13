import React from 'react'

export function ToastContainer({ toasts, onRemove }) {
  if (!toasts.length) return null

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' }

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`toast toast-${t.type}`}
          onClick={() => onRemove(t.id)}
          role="alert"
        >
          <span>{icons[t.type]}</span>
          <span style={{ flex: 1 }}>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
