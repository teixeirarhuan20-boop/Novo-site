import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'

// ─── Card: Oportunidade de Mercado ─────────────────────────────────────────────
function MarketOpportunityCard({ data }) {
  const { opportunities = [], summary } = data || {}
  const [expanded, setExpanded] = useState(null)

  if (!opportunities.length) {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        border: '1px solid #334155',
        borderRadius: 12,
        padding: '0.9rem 1rem',
        color: '#94a3b8',
        fontSize: '0.82rem',
      }}>
        🎯 Sem oportunidades encontradas no momento.
      </div>
    )
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
      border: '1px solid #4338ca55',
      borderRadius: 14,
      overflow: 'hidden',
      fontSize: '0.82rem',
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(90deg, #4f46e5 0%, #7c3aed 100%)',
        padding: '0.7rem 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}>
        <span style={{ fontSize: '1rem' }}>🎯</span>
        <div>
          <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.88rem' }}>
            Oportunidades de Cross-Selling
          </div>
          <div style={{ color: '#c4b5fd', fontSize: '0.72rem' }}>
            {opportunities.length} cidade{opportunities.length > 1 ? 's' : ''} com leads não alcançados
          </div>
        </div>
      </div>

      {/* Lista de oportunidades */}
      <div style={{ padding: '0.6rem' }}>
        {opportunities.map((opp, i) => (
          <div
            key={i}
            style={{
              background: expanded === i ? '#1e293b' : '#0f172a',
              border: `1px solid ${expanded === i ? '#4f46e5' : '#1e293b'}`,
              borderRadius: 10,
              marginBottom: '0.45rem',
              overflow: 'hidden',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onClick={() => setExpanded(expanded === i ? null : i)}
          >
            {/* Linha principal */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.6rem 0.8rem',
            }}>
              {/* Badge com nº de leads */}
              <div style={{
                background: '#4f46e5',
                color: '#fff',
                borderRadius: 20,
                padding: '0.15rem 0.55rem',
                fontWeight: 700,
                fontSize: '0.78rem',
                flexShrink: 0,
              }}>
                {opp.untappedLeads} leads
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.82rem' }}>
                  📍 {opp.city}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  🔥 {opp.topProduct} · {opp.revenueFromCity}
                </div>
              </div>
              <span style={{ color: '#64748b', fontSize: '0.7rem', flexShrink: 0 }}>
                {expanded === i ? '▲' : '▼'}
              </span>
            </div>

            {/* Detalhes expandidos */}
            {expanded === i && (
              <div style={{
                borderTop: '1px solid #1e293b',
                padding: '0.7rem 0.8rem',
              }}>
                {/* Produtos mais vendidos na cidade */}
                {opp.allProducts?.length > 0 && (
                  <div style={{ marginBottom: '0.6rem' }}>
                    <div style={{ color: '#7c3aed', fontWeight: 600, fontSize: '0.72rem', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Produtos com demanda
                    </div>
                    {opp.allProducts.map((p, j) => (
                      <div key={j} style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1', fontSize: '0.75rem', padding: '0.15rem 0' }}>
                        <span>📦 {p.name}</span>
                        <span style={{ color: '#a78bfa' }}>{p.qty} un · {p.revenue}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Leads de amostra */}
                {opp.sampleLeads?.length > 0 && (
                  <div>
                    <div style={{ color: '#0ea5e9', fontWeight: 600, fontSize: '0.72rem', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Leads para abordar
                    </div>
                    {opp.sampleLeads.map((l, j) => (
                      <div key={j} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: '#0f172a',
                        borderRadius: 6,
                        padding: '0.35rem 0.6rem',
                        marginBottom: '0.25rem',
                      }}>
                        <div>
                          <div style={{ color: '#e2e8f0', fontSize: '0.78rem' }}>{l.nome}</div>
                          {l.telefone && <div style={{ color: '#64748b', fontSize: '0.7rem' }}>📞 {l.telefone}</div>}
                        </div>
                        <span style={{
                          background: l.status === 'quente' ? '#dc2626' : l.status === 'morno' ? '#d97706' : '#059669',
                          color: '#fff',
                          fontSize: '0.65rem',
                          borderRadius: 10,
                          padding: '0.1rem 0.4rem',
                          fontWeight: 600,
                          textTransform: 'capitalize',
                        }}>
                          {l.status}
                        </span>
                      </div>
                    ))}
                    {opp.untappedLeads > opp.sampleLeads.length && (
                      <div style={{ color: '#4f46e5', fontSize: '0.72rem', textAlign: 'center', paddingTop: '0.2rem' }}>
                        +{opp.untappedLeads - opp.sampleLeads.length} outros leads
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer com resumo */}
      {summary && (
        <div style={{
          padding: '0.5rem 1rem',
          borderTop: '1px solid #1e293b',
          color: '#94a3b8',
          fontSize: '0.72rem',
          lineHeight: 1.5,
        }}>
          💡 {summary}
        </div>
      )}
    </div>
  )
}

// ─── Card: Pedido Pendente (confirmação) ───────────────────────────────────────
function PendingOrderCard({ data, onConfirm, onCancel }) {
  const [confirmed, setConfirmed] = useState(false)
  const [cancelled, setCancelled] = useState(false)

  if (!data) return null

  const handleConfirm = () => {
    setConfirmed(true)
    onConfirm?.(data)
  }

  const handleCancel = () => {
    setCancelled(true)
    onCancel?.(data)
  }

  const isDone = confirmed || cancelled

  return (
    <div style={{
      background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
      border: `1px solid ${confirmed ? '#16a34a' : cancelled ? '#dc2626' : '#0ea5e9'}`,
      borderRadius: 14,
      overflow: 'hidden',
      fontSize: '0.82rem',
    }}>
      {/* Header */}
      <div style={{
        background: confirmed ? 'linear-gradient(90deg,#16a34a,#15803d)' :
                    cancelled ? 'linear-gradient(90deg,#dc2626,#b91c1c)' :
                    'linear-gradient(90deg,#0ea5e9,#0284c7)',
        padding: '0.65rem 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}>
        <span style={{ fontSize: '1rem' }}>
          {confirmed ? '✅' : cancelled ? '❌' : '🛒'}
        </span>
        <div>
          <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.88rem' }}>
            {confirmed ? 'Pedido Confirmado!' : cancelled ? 'Pedido Cancelado' : 'Confirmar Pedido'}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.72rem' }}>
            {confirmed ? 'Registrado no sistema' : cancelled ? 'Nenhuma alteração feita' : 'Revise antes de confirmar'}
          </div>
        </div>
      </div>

      {/* Detalhes do pedido */}
      <div style={{ padding: '0.75rem 1rem' }}>
        {[
          ['Cliente',    data.customerName],
          ['Produto',    data.productName],
          ['Quantidade', data.quantity],
          ['Cidade',     data.location || data.city],
          ['CEP',        data.cep],
          ['Pedido Nº',  data.orderId],
          ['Rastreio',   data.rastreio],
        ].filter(([, v]) => v).map(([label, value]) => (
          <div key={label} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.3rem 0',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}>
            <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{label}</span>
            <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Botões de ação */}
      {!isDone && (
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.6rem 1rem 0.8rem',
        }}>
          <button
            onClick={handleConfirm}
            style={{
              flex: 1, padding: '0.55rem',
              background: 'linear-gradient(135deg,#16a34a,#15803d)',
              color: '#fff', border: 'none', borderRadius: 8,
              fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseOver={e => e.currentTarget.style.opacity = '0.85'}
            onMouseOut={e => e.currentTarget.style.opacity = '1'}
          >
            ✅ Confirmar
          </button>
          <button
            onClick={handleCancel}
            style={{
              flex: 1, padding: '0.55rem',
              background: 'rgba(220,38,38,0.15)',
              color: '#fca5a5', border: '1px solid #dc2626',
              borderRadius: 8, fontWeight: 600, fontSize: '0.82rem',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseOver={e => { e.currentTarget.style.background = '#dc2626'; e.currentTarget.style.color = '#fff' }}
            onMouseOut={e => { e.currentTarget.style.background = 'rgba(220,38,38,0.15)'; e.currentTarget.style.color = '#fca5a5' }}
          >
            ✕ Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ──────────────────────────────────────────────────────
export function ChatMessage({ role, text, imagePreview, imageName, type, data, onConfirm, onCancel }) {
  return (
    <div className={`chat-msg ${role}`}>
      <div className={`msg-avatar ${role}`}>
        {role === 'bot' ? 'IA' : 'EU'}
      </div>
      <div className="msg-bubble" style={type ? { background: 'transparent', padding: 0, boxShadow: 'none' } : undefined}>

        {/* Prévia da imagem enviada pelo usuário */}
        {role === 'user' && imagePreview && (
          <div style={{ marginBottom: '0.4rem' }}>
            <img
              src={imagePreview}
              alt={imageName || 'imagem'}
              style={{
                maxWidth: 180, maxHeight: 140,
                borderRadius: 8, objectFit: 'cover',
                display: 'block', opacity: 0.92,
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

        {/* Cards estruturados */}
        {type === 'market_opportunity' && (
          <MarketOpportunityCard data={data} />
        )}

        {type === 'pending_order' && (
          <PendingOrderCard data={data} onConfirm={onConfirm} onCancel={onCancel} />
        )}

        {/* Texto da mensagem (renderizado para todos os tipos, exceto cards puros) */}
        {!type && text && (
          role === 'bot'
            ? <ReactMarkdown>{text}</ReactMarkdown>
            : <span>{text}</span>
        )}

        {/* Texto adicional junto com card (ex: mensagem da Luna sobre oportunidade) */}
        {type && text && (
          <div style={{ marginTop: '0.5rem' }}>
            {role === 'bot'
              ? <ReactMarkdown>{text}</ReactMarkdown>
              : <span>{text}</span>
            }
          </div>
        )}
      </div>
    </div>
  )
}
