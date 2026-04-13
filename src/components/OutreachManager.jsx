import React, { useState } from 'react'
import { generateOutreachMessage } from '../lib/gemini'

export function OutreachManager({ outreachLeads, setOutreachLeads, inventory, addToast }) {
  const [messages,    setMessages]    = useState({})
  const [generating,  setGenerating]  = useState({})

  const generateMessage = async (lead) => {
    setGenerating(prev => ({ ...prev, [lead.id]: true }))
    try {
      const msg = await generateOutreachMessage(lead, inventory)
      setMessages(prev => ({ ...prev, [lead.id]: msg }))
    } catch {
      addToast('Erro ao gerar mensagem.', 'error')
    } finally {
      setGenerating(prev => ({ ...prev, [lead.id]: false }))
    }
  }

  const copyMessage = (id) => {
    const msg = messages[id]
    if (!msg) return
    navigator.clipboard.writeText(msg)
    addToast('Mensagem copiada!', 'success')
  }

  const openWhatsApp = (lead, id) => {
    const msg = messages[id]
    if (!msg || !lead.telefone) {
      addToast('Gere uma mensagem e certifique-se que o lead tem telefone.', 'warning')
      return
    }
    const phone = lead.telefone.replace(/\D/g, '')
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const removeLead = (id) => {
    setOutreachLeads(prev => prev.filter(l => l.id !== id))
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>📣 Abordagem — Ana</h1>
        <p>Gere mensagens personalizadas com IA e envie pelo WhatsApp</p>
      </div>

      {outreachLeads.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: '3rem' }}>
            Nenhum lead na fila.<br />
            <span className="text-small">Envie leads da aba "Leads" para cá clicando em "Enviar p/ Ana".</span>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {outreachLeads.map(lead => (
            <div key={lead.id} className="card">
              <div className="flex-between mb-2">
                <div>
                  <span className="font-bold" style={{ fontSize: '1rem' }}>{lead.nome || 'Lead'}</span>
                  <span className="text-muted text-small" style={{ marginLeft: '0.75rem' }}>
                    {lead.telefone && `📱 ${lead.telefone}`}
                    {lead.email && ` · ✉️ ${lead.email}`}
                  </span>
                </div>
                <button className="btn btn-danger btn-sm" onClick={() => removeLead(lead.id)}>Remover</button>
              </div>

              {/* Mensagem gerada */}
              {messages[lead.id] ? (
                <div style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '0.85rem',
                  fontSize: '0.875rem',
                  lineHeight: 1.6,
                  marginBottom: '0.75rem',
                  whiteSpace: 'pre-wrap',
                }}>
                  {messages[lead.id]}
                </div>
              ) : (
                <div style={{
                  background: 'var(--surface-2)',
                  border: '1px dashed var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '0.85rem',
                  fontSize: '0.875rem',
                  color: 'var(--text-faint)',
                  textAlign: 'center',
                  marginBottom: '0.75rem',
                }}>
                  Clique em "Gerar Mensagem" para criar uma abordagem personalizada com IA
                </div>
              )}

              <div className="flex gap-1">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => generateMessage(lead)}
                  disabled={generating[lead.id]}
                >
                  {generating[lead.id] ? '⏳ Gerando...' : '🤖 Gerar Mensagem'}
                </button>
                {messages[lead.id] && (
                  <>
                    <button className="btn btn-secondary btn-sm" onClick={() => copyMessage(lead.id)}>
                      📋 Copiar
                    </button>
                    <button
                      className="btn btn-success btn-sm"
                      onClick={() => openWhatsApp(lead, lead.id)}
                      disabled={!lead.telefone}
                      title={!lead.telefone ? 'Lead sem telefone cadastrado' : 'Abrir WhatsApp'}
                    >
                      💬 WhatsApp
                    </button>
                  </>
                )}
                <button className="btn btn-danger btn-sm" onClick={() => removeLead(lead.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}