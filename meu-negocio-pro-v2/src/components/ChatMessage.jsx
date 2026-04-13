import React from 'react'
import ReactMarkdown from 'react-markdown'

export function ChatMessage({ role, text }) {
  return (
    <div className={`chat-msg ${role}`}>
      <div className={`msg-avatar ${role}`}>
        {role === 'bot' ? 'IA' : 'EU'}
      </div>
      <div className="msg-bubble">
        {role === 'bot'
          ? <ReactMarkdown>{text}</ReactMarkdown>
          : text
        }
      </div>
    </div>
  )
}
