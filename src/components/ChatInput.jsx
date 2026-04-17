import React, { useState, useRef } from 'react'

export function ChatInput({ onSend, disabled }) {
  const [text,      setText]      = useState('')
  const [imageData, setImageData] = useState(null) // { base64, mimeType, preview, name }
  const fileRef = useRef(null)

  // ── Converte arquivo para base64 ──────────────────────────────────────────
  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target.result
      setImageData({
        base64:  dataUrl.split(',')[1],
        mimeType: file.type,
        preview: dataUrl,
        name:    file.name,
      })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // ── Enviar ────────────────────────────────────────────────────────────────
  const submit = () => {
    const trimmed = text.trim()
    if ((!trimmed && !imageData) || disabled) return
    onSend(trimmed || '📷 Analise esta imagem para mim.', imageData || null)
    setText('')
    setImageData(null)
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  return (
    <div className="chat-input-area" style={{ flexDirection: 'column', padding: '0.65rem 0.85rem', gap: '0.45rem' }}>

      {/* Preview da imagem selecionada */}
      {imageData && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: '#eff6ff', border: '1px solid #bfdbfe',
          borderRadius: 8, padding: '0.35rem 0.6rem',
        }}>
          <img src={imageData.preview} alt="preview" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} />
          <span style={{ fontSize: '0.75rem', color: '#1d4ed8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {imageData.name}
          </span>
          <button
            onClick={() => setImageData(null)}
            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 2, flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Linha de input */}
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          title="Enviar imagem (print de WhatsApp, comprovante, etiqueta...)"
          style={{
            flexShrink: 0, width: 36, height: 36,
            background: imageData ? '#eff6ff' : 'var(--surface-2)',
            border: `1px solid ${imageData ? '#bfdbfe' : 'var(--border)'}`,
            borderRadius: 8, cursor: 'pointer', fontSize: '1rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: imageData ? '#2563eb' : 'var(--text-muted)', transition: 'all 0.15s',
          }}
        >
          📷
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder={imageData ? 'O que quer saber sobre a imagem? (Enter envia)' : 'Mensagem ou 📷 imagem… (Enter para enviar)'}
          rows={2}
          disabled={disabled}
          style={{ flex: 1, resize: 'none' }}
        />

        <button
          className="chat-send-btn"
          onClick={submit}
          disabled={disabled || (!text.trim() && !imageData)}
          style={{ flexShrink: 0 }}
        >
          {disabled ? '⏳' : '➤'}
        </button>
      </div>
    </div>
  )
}
