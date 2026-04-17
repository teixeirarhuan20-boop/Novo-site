import React from 'react'
import ReactMarkdown from 'react-markdown'

export function ChatMessage({ role, text, imagePreview, imageName }) {
  return (
    <div className={`chat-msg ${role}`}>
      <div className={`msg-avatar ${role}`}>
        {role === 'bot' ? 'IA' : 'EU'}
      </div>
      <div className="msg-bubble">
        {/* Prévia da imagem enviada pelo usuário */}
        {role === 'user' && imagePreview && (
          <div style={{ marginBottom: '0.4rem' }}>
            <img
              src={imagePreview}
              alt={imageName || 'imagem'}
              style={{
                maxWidth: 180,
                maxHeight: 140,
                borderRadius: 8,
                objectFit: 'cover',
                display: 'block',
                opacity: 0.92,
                border: '2px solid rgba(255,255,255,0.2)',
              }}
            />
            {imageName && (
              <span style={{ fontSize: '0.68rem', opacity: 0.7, display: 'block', marginTop: 3 }}>
                📷 {imageName}
              </span>
            )}
          </div>
        )}

        {/* Texto da mensagem */}
        {text && (
          role === 'bot'
            ? <ReactMarkdown>{text}</ReactMarkdown>
            : <span>{text}</span>
        )}
      </div>
    </div>
  )
}