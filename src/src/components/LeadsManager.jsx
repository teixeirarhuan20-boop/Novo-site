import React, { useState } from 'react'
import { generateId, formatDate } from '../utils/formatting'

export function LeadsManager({ leads, setLeads, onSendToAna, addToast }) {
  const [search, setSearch] = useState('')

  const filtered = leads.filter(l =>
    !search ||
    l.nome?.toLowerCase().includes(search.toLowerCase()) ||
    l.email?.toLowerCase().includes(search.toLowerCase())
  )

  const deleteLead = (id) => {
    setLeads(prev => prev.filter(l => l.id !== id))
    addToast('Lead removido.', 'success')
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>🎯 Leads Capturados</h1>
        <p>Contatos capturados pela Vendedora Virtual (Luna)</p>
      </div>

      <div className="stat-grid mb-3" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="stat-card">
          <span className="stat-label">Total de Leads</span>
          <span className="stat-value">{leads.length}</span>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid var(--primary)' }}>
          <span className="stat-label">Aguardando Abordagem</span>
          <span className="stat-value color-blue">{leads.length}</span>
        </div>
      </div>

      <div className="filters mb-2">
        <input
          className="search-input"
          type="text"
          placeholder="🔍 Buscar lead..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="text-muted text-small">{filtered.length} lead(s)</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: '3rem' }}>
            Nenhum lead capturado ainda.<br />
            <span className="text-small">Use a Vendedora Virtual (Luna) para capturar contatos automaticamente.</span>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Nome</th><th>E-mail</th><th>Telefone</th><th>Data</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id}>
                  <td className="font-medium">{l.nome || '—'}</td>
                  <td className="text-muted text-small">{l.email || '—'}</td>
                  <td className="text-muted text-small">{l.telefone || '—'}</td>
                  <td className="text-muted text-small">{l.data || '—'}</td>
                  <td>
                    <div className="flex gap-1">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => onSendToAna(l)}
                        title="Enviar para a Ana fazer abordagem"
                      >
                        📤 Enviar p/ Ana
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteLead(l.id)}>✕</button>
                    </div>
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
