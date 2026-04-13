import React from 'react';
import ReactMarkdown from 'react-markdown';

export function ChatMessage({ text, role }) {
  const isBot = role === 'bot';

  return (
    <div className={`message-wrapper ${isBot ? 'bot' : 'user'}`}>
      <div className="message-content">
        <div className={`avatar ${isBot ? 'bot' : 'user'}`}>
          {isBot ? 'AI' : 'You'}
        </div>
        <div className="text-content">
          {text === '...' ? (
            <div className="loading-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          ) : (
            <ReactMarkdown>{text}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}
