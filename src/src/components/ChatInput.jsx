import React, { useState, useRef } from 'react'

export function ChatInput({ onSend, disabled }) {
  const [text, setText] = useState('')
  const ref = useRef(null)

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="chat-input-area">
      <textarea
        ref={ref}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Digite sua mensagem… (Enter para enviar)"
        rows={2}
        disabled={disabled}
      />
      <button className="chat-send-btn" onClick={submit} disabled={disabled || !text.trim()}>
        {disabled ? '...' : '➤'}
      </button>
    </div>
  )
}
