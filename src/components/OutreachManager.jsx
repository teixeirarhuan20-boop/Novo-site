import React, { useState } from 'react'
import { generateOutreachMessage } from '../lib/gemini'
import { AnaBatchFlow } from './AnaBatchFlow'

export function OutreachManager({ outreachLeads, setOutreachLeads, inventory, setInventory, transactions, setTransactions, pessoas, setPessoas, addToast }) {
  const [messages,    setMessages]    = useState({})
  const [generating,  setGenerating]  = useState({})
  const [batchOpen,   setBatchOpen]   = useState(false)

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
    <>
      {/* ── Modo Lote Contínuo (overlay fullscreen) ── */}
      {batchOpen && (
        <AnaBatchFlow
          inventory={inventory}
          setInventory={setInventory}
          transactions={transactions}
          setTransactions={setTransactions}
          pessoas={pessoas}
          setPessoas={setPessoas}
          addToast={addToast}
          onClose={() => setBatchOpen(false)}
        />
      )}

    <div className="page">
      <div className="page-header">
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1>📣 Abordagem — Ana</h1>
            <p>Gere mensagens personalizadas com IA e envie pelo WhatsApp</p>
          </div>
          <button
            type="button"
            onClick={() => setBatchOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0.55rem 1.1rem', borderRadius: 10,
              border: '2px solid #7c3aed', background: '#7c3aed',
              color: '#fff', fontSize: '0.85rem', fontWeight: 700,
              cursor: 'pointer', transition: 'all 0.15s',
              boxShadow: '0 2px 8px rgba(124,58,237,0.35)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#6d28d9'; e.currentTarget.style.borderColor = '#6d28d9' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#7c3aed'; e.currentTarget.style.borderColor = '#7c3aed' }}
            title="Ativar modo de leitura em lote automática com câmera"
          >
            🔄 Modo Lote Contínuo
          </button>
        </div>
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
    </>
  )
}