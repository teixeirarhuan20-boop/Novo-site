import React, { useState, useEffect } from 'react';

export function SystemLogManager() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    // Carregar logs iniciais se houver algo no sessionStorage/localStorage
    const savedLogs = JSON.parse(localStorage.getItem('systemErrorLogs') || '[]');
    setLogs(savedLogs);

    // Listener para eventos customizados de log
    const handleLogEvent = (e) => {
      const newLog = {
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        type: e.detail.type || 'info', // 'error', 'info', 'ai'
        message: e.detail.message,
        data: e.detail.data || null
      };
      
      setLogs(prev => {
        const updated = [newLog, ...prev].slice(0, 100); // Manter as últimas 100
        localStorage.setItem('systemErrorLogs', JSON.stringify(updated));
        return updated;
      });
    };

    window.addEventListener('add-system-log', handleLogEvent);
    return () => window.removeEventListener('add-system-log', handleLogEvent);
  }, []);

  const clearLogs = () => {
    setLogs([]);
    localStorage.removeItem('systemErrorLogs');
  };

  const copyToClipboard = () => {
    const text = JSON.stringify(logs, null, 2);
    navigator.clipboard.writeText(text);
    alert('Logs copiados para a área de transferência!');
  };

  return (
    <div className="inventory-panel">
      <div className="bi-header">
        <div>
          <h1>🚨 Log de Erros e Sistema</h1>
          <p>Tudo o que acontece nos "bastidores" da IA e do sistema aparece aqui.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={copyToClipboard} className="nav-item" style={{ background: '#3b82f6', color: 'white' }}>📋 Copiar Tudo</button>
          <button onClick={clearLogs} className="nav-item" style={{ background: '#ef4444', color: 'white' }}>🗑️ Limpar</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        {logs.length === 0 && (
          <div className="bi-card" style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
            Nenhum evento registrado ainda.
          </div>
        )}
        {logs.map(log => (
          <div key={log.id} className="bi-card" style={{ 
            borderLeft: `5px solid ${log.type === 'error' ? '#ef4444' : log.type === 'ai' ? '#3b82f6' : '#10a37f'}`,
            padding: '1rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#64748b' }}>
                [{log.timestamp}] {log.type.toUpperCase()}
              </span>
            </div>
            <div style={{ fontWeight: '500', color: '#1e293b', marginBottom: '0.5rem' }}>
              {log.message}
            </div>
            {log.data && (
              <pre style={{ 
                background: '#f1f5f9', 
                padding: '0.8rem', 
                borderRadius: '6px', 
                fontSize: '0.8rem', 
                overflowX: 'auto',
                border: '1px solid #e2e8f0',
                margin: 0
              }}>
                {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Utilitário global para facilitar o uso
window.addSystemLog = (message, type = 'info', data = null) => {
  window.dispatchEvent(new CustomEvent('add-system-log', {
    detail: { message, type, data }
  }));
};
