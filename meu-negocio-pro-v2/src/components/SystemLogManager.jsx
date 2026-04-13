import React, { useState, useEffect } from 'react'

// Intercepta console.error e console.warn globalmente
const logs = []
const _error = console.error.bind(console)
const _warn  = console.warn.bind(console)

console.error = (...args) => {
  logs.unshift({ level: 'error', msg: args.map(String).join(' '), time: new Date().toLocaleTimeString() })
  if (logs.length > 100) logs.pop()
  _error(...args)
}
console.warn = (...args) => {
  logs.unshift({ level: 'warn', msg: args.map(String).join(' '), time: new Date().toLocaleTimeString() })
  if (logs.length > 100) logs.pop()
  _warn(...args)
}

export function SystemLogManager() {
  const [entries, setEntries] = useState([...logs])
  const [filter,  setFilter]  = useState('all')

  useEffect(() => {
    const id = setInterval(() => setEntries([...logs]), 2000)
    return () => clearInterval(id)
  }, [])

  const filtered = filter === 'all' ? entries : entries.filter(e => e.level === filter)

  return (
    <div className="page">
      <div className="page-header">
        <h1>🚨 Log de Erros</h1>
        <p>Monitoramento em tempo real de erros e avisos do sistema</p>
      </div>

      <div className="filters mb-2">
        <select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">Todos ({entries.length})</option>
          <option value="error">Erros ({entries.filter(e => e.level === 'error').length})</option>
          <option value="warn">Avisos ({entries.filter(e => e.level === 'warn').length})</option>
        </select>
        <button className="btn btn-secondary btn-sm" onClick={() => { logs.length = 0; setEntries([]) }}>
          🗑 Limpar
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: '4rem' }}>
            ✅ Nenhum erro registrado. Sistema funcionando normalmente.
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Hora</th><th>Nível</th><th>Mensagem</th></tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={i}>
                  <td className="text-small text-muted" style={{ whiteSpace: 'nowrap' }}>{e.time}</td>
                  <td>
                    <span className={`badge ${e.level === 'error' ? 'badge-red' : 'badge-orange'}`}>
                      {e.level === 'error' ? '❌ Erro' : '⚠️ Aviso'}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                    {e.msg}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
