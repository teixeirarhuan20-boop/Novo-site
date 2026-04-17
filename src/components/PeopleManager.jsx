import React, { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { generateId, formatDate, normalizeText, formatCurrency } from '../utils/formatting'
import { unpackLocation } from '../utils/location'

const EMPTY = {
  name: '', document: '', role: 'cliente', gender: '',
  contact: '', email: '', address: '', cep: '', city: ''
}

const curveMeta = {
  A: { bg: '#fef3c7', color: '#92400e', border: '#f59e0b', label: 'Ouro ⭐' },
  B: { bg: '#dbeafe', color: '#1e40af', border: '#3b82f6', label: 'Prata 🥈' },
  C: { bg: '#f1f5f9', color: '#475569', border: '#94a3b8', label: 'Bronze 🥉' },
}

export function PeopleManager({ pessoas, setPessoas, transactions, addToast }) {
  const [form,     setForm]     = useState(EMPTY)
  const [search,   setSearch]   = useState('')
  const [expanded, setExpanded] = useState(null) // id da pessoa expandida

  // ── Estatísticas + itens por pessoa ───────────────────────────────────────
  const stats = useMemo(() => {
    const map = {}
    ;(transactions || []).forEach(t => {
      if (!t.personName || t.type !== 'saída') return
      if (!map[t.personName]) map[t.personName] = { total: 0, count: 0, items: {} }
      map[t.personName].total += Number(t.totalValue || 0)
      map[t.personName].count++
      // Extrai nome limpo do produto
      const loc  = unpackLocation(t.itemName)
      const nome = loc?.cleanName || t.itemName.split('||')[0].trim()
      if (!map[t.personName].items[nome]) map[t.personName].items[nome] = { qtd: 0, total: 0 }
      map[t.personName].items[nome].qtd   += Number(t.quantity || 1)
      map[t.personName].items[nome].total += Number(t.totalValue || 0)
    })
    return map
  }, [transactions])

  // ── Enriquecimento + curva ABC + ordenar por contagem de compras ──────────
  const enriched = useMemo(() => {
    const withStats = pessoas.map(p => ({
      ...p,
      total: stats[p.name]?.total || 0,
      count: stats[p.name]?.count || 0,
    })).sort((a, b) => b.count - a.count || b.total - a.total) // mais compras primeiro

    const totalRevenue = withStats.reduce((s, p) => s + p.total, 0)
    let cumulative = 0
    return withStats.map(p => {
      cumulative += p.total
      const pct = totalRevenue > 0 ? cumulative / totalRevenue : 1
      return { ...p, curve: pct <= 0.80 ? 'A' : pct <= 0.95 ? 'B' : 'C' }
    })
  }, [pessoas, stats])

  // ── Filtro de busca ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const tokens = normalizeText(search).split(/\s+/).filter(Boolean)
    if (!tokens.length) return enriched
    return enriched.filter(p => {
      const content = normalizeText(`${p.name} ${p.city || ''} ${p.contact || ''} ${p.email || ''}`)
      return tokens.every(t => content.includes(t))
    })
  }, [enriched, search])

  const abcSummary = ['A', 'B', 'C'].map(curve => ({
    curve,
    count:   enriched.filter(p => p.curve === curve).length,
    revenue: enriched.filter(p => p.curve === curve).reduce((s, p) => s + p.total, 0),
  }))

  // ── Cadastrar pessoa ──────────────────────────────────────────────────────
  const addPerson = async (e) => {
    e.preventDefault()
    if (!form.name) return
    const p = { id: generateId(), ...form, created_at: new Date().toISOString(), source: 'Cadastro manual' }
    setPessoas(prev => [...prev, p])
    setForm(EMPTY)
    const { error } = await supabase.from('pessoas').insert([p])
    if (error) addToast(`Erro: ${error.message}`, 'error')
    else addToast(`"${p.name}" cadastrado(a)!`, 'success')
  }

  // ── Remover pessoa ────────────────────────────────────────────────────────
  const deletePerson = async (id, name) => {
    if (!window.confirm(`Remover "${name}"?`)) return
    setPessoas(prev => prev.filter(p => p.id !== id))
    await supabase.from('pessoas').delete().eq('id', id)
    addToast(`"${name}" removido(a).`, 'success')
  }

  // ── Toggle expandir ───────────────────────────────────────────────────────
  const toggle = (id) => setExpanded(prev => prev === id ? null : id)

  return (
    <div className="page">
      <div className="page-header">
        <h1>👥 Pessoas / CRM</h1>
        <p>Clientes e fornecedores — ordenados por quantidade de compras</p>
      </div>

      {/* ── Resumo ABC ── */}
      <div className="stat-grid mb-3" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        {abcSummary.map(({ curve, count, revenue }) => (
          <div key={curve} className="stat-card" style={{ borderLeft: `4px solid ${curveMeta[curve].border}` }}>
            <span className="stat-label">Curva {curve} — {curveMeta[curve].label}</span>
            <span className="stat-value">{count}</span>
            <span className="stat-sub">{formatCurrency(revenue)}</span>
          </div>
        ))}
      </div>

      {/* ── Formulário de cadastro ── */}
      <div className="card mb-3">
        <h3 style={{ marginBottom: '1rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          + Cadastrar Pessoa
        </h3>
        <form onSubmit={addPerson}>
          <div className="form-row" style={{ marginBottom: '0.75rem' }}>
            <div className="form-group" style={{ flex: 2 }}>
              <label>Nome / Razão Social *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required placeholder="Nome completo" />
            </div>
            <div className="form-group">
              <label>CPF / CNPJ</label>
              <input type="text" value={form.document} onChange={e => setForm(p => ({ ...p, document: e.target.value }))} placeholder="Opcional" />
            </div>
            <div className="form-group" style={{ maxWidth: 140 }}>
              <label>Tipo</label>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                <option value="cliente">Cliente</option>
                <option value="fornecedor">Fornecedor</option>
                <option value="ambos">Ambos</option>
              </select>
            </div>
            <div className="form-group" style={{ maxWidth: 130 }}>
              <label>Sexo</label>
              <select value={form.gender} onChange={e => setForm(p => ({ ...p, gender: e.target.value }))}>
                <option value="">Não informado</option>
                <option value="M">♂ Masculino</option>
                <option value="F">♀ Feminino</option>
                <option value="O">⚧ Outro</option>
              </select>
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: '0.75rem' }}>
            <div className="form-group"><label>Telefone</label><input type="text" value={form.contact} onChange={e => setForm(p => ({ ...p, contact: e.target.value }))} placeholder="(11) 9..." /></div>
            <div className="form-group"><label>E-mail</label><input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@..." /></div>
            <div className="form-group" style={{ maxWidth: 120 }}><label>CEP</label><input type="text" value={form.cep} onChange={e => setForm(p => ({ ...p, cep: e.target.value }))} placeholder="00000-000" /></div>
            <div className="form-group"><label>Cidade</label><input type="text" value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} placeholder="São Paulo" /></div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}><label>Endereço Completo</label><input type="text" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="Rua, Número, Bairro" /></div>
            <div className="form-group" style={{ justifyContent: 'flex-end', flex: 0 }}>
              <button type="submit" className="btn btn-primary">Cadastrar</button>
            </div>
          </div>
        </form>
      </div>

      {/* ── Busca ── */}
      <div className="flex-between mb-2">
        <span className="text-muted text-small">{filtered.length} pessoa(s) — clique no nome para ver os dados</span>
        <input
          type="text"
          placeholder="🔍 Buscar nome, cidade, contato..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
      </div>

      {/* ── Lista de pessoas (expandível) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {filtered.length === 0 && (
          <div className="card">
            <div className="empty-state">Nenhuma pessoa encontrada.</div>
          </div>
        )}

        {filtered.map((p, idx) => {
          const m    = curveMeta[p.curve]
          const open = expanded === p.id

          return (
            <div
              key={p.id}
              className="card"
              style={{
                padding: 0,
                borderLeft: `4px solid ${m.border}`,
                overflow: 'hidden',
              }}
            >
              {/* ── Linha resumo (sempre visível) ── */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                onClick={() => toggle(p.id)}
              >
                {/* Posição */}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', minWidth: 24, textAlign: 'center', fontWeight: 700 }}>
                  #{idx + 1}
                </span>

                {/* Badge curva */}
                <span style={{
                  padding: '2px 10px', borderRadius: 999, fontSize: '0.7rem',
                  fontWeight: 700, background: m.bg, color: m.color, border: `1px solid ${m.border}`,
                  flexShrink: 0,
                }}>
                  {p.curve}
                </span>

                {/* Nome */}
                <span style={{ fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.gender === 'M' ? '♂ ' : p.gender === 'F' ? '♀ ' : ''}{p.name}
                </span>

                {/* Cidade */}
                <span className="text-muted text-small" style={{ minWidth: 90 }}>
                  {p.city || '—'}
                </span>

                {/* Compras */}
                <span style={{ fontWeight: 700, color: 'var(--primary)', minWidth: 60, textAlign: 'center', fontSize: '0.85rem' }}>
                  🛒 {p.count}
                </span>

                {/* Total gasto */}
                <span style={{ fontWeight: 700, color: p.total > 0 ? 'var(--success)' : 'var(--text-faint)', minWidth: 100, textAlign: 'right', fontSize: '0.9rem' }}>
                  {formatCurrency(p.total)}
                </span>

                {/* Seta */}
                <span style={{ color: 'var(--text-faint)', fontSize: '0.8rem', flexShrink: 0 }}>
                  {open ? '▲' : '▼'}
                </span>
              </div>

              {/* ── Dados completos (expandível) ── */}
              {open && (
                <div style={{
                  padding: '1rem',
                  borderTop: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: '0.75rem',
                }}>
                  {[
                    { label: '🪪 CPF / CNPJ',  value: p.document },
                    { label: '👤 Tipo',          value: p.role },
                    { label: '⚧ Sexo',          value: p.gender === 'M' ? 'Masculino' : p.gender === 'F' ? 'Feminino' : p.gender === 'O' ? 'Outro' : 'Não informado' },
                    { label: '📞 Telefone',      value: p.contact },
                    { label: '📧 E-mail',        value: p.email },
                    { label: '🏙️ Cidade',       value: p.city },
                    { label: '📮 CEP',           value: p.cep },
                    { label: '📍 Endereço',      value: p.address },
                    { label: '📅 Cadastrado em', value: p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : '—' },
                    { label: '🔗 Origem',        value: p.source },
                  ].map(({ label, value }) => value ? (
                    <div key={label}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginBottom: '0.15rem' }}>{label}</div>
                      <div style={{ fontSize: '0.88rem', color: 'var(--text)', fontWeight: 500 }}>{value}</div>
                    </div>
                  ) : null)}

                  {/* Histórico de compras */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginBottom: '0.6rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      🛒 Histórico de Compras
                    </div>

                    {/* Totais resumidos */}
                    <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                      <span style={{ fontSize: '0.82rem' }}>
                        <strong>{p.count}</strong> pedido{p.count !== 1 ? 's' : ''}
                      </span>
                      <span style={{ fontSize: '0.82rem', color: 'var(--success)', fontWeight: 700 }}>
                        Total: {formatCurrency(p.total)}
                      </span>
                      {p.count > 0 && (
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          Ticket médio: {formatCurrency(p.total / p.count)}
                        </span>
                      )}
                    </div>

                    {/* Itens comprados */}
                    {(() => {
                      const itens = Object.entries(stats[p.name]?.items || {})
                        .map(([nome, v]) => ({ nome, ...v }))
                        .sort((a, b) => b.qtd - a.qtd)
                      if (itens.length === 0) return (
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>Nenhuma compra registrada.</p>
                      )
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {itens.map(item => (
                            <div key={item.nome} style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              background: 'var(--surface)', border: '1px solid var(--border)',
                              borderRadius: 8, padding: '0.45rem 0.75rem',
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: '0.9rem' }}>📦</span>
                                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {item.nome}
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexShrink: 0, marginLeft: '0.5rem' }}>
                                <span style={{ fontSize: '0.72rem', background: 'var(--primary-light)', color: 'var(--primary)', padding: '2px 8px', borderRadius: 99, fontWeight: 700 }}>
                                  {item.qtd} un.
                                </span>
                                <span style={{ fontSize: '0.78rem', color: 'var(--success)', fontWeight: 700, minWidth: 70, textAlign: 'right' }}>
                                  {formatCurrency(item.total)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>

                  {/* Ações */}
                  <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                    {p.contact && (
                      <a href={`https://wa.me/55${p.contact.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" className="btn btn-success btn-sm" style={{ textDecoration: 'none', fontSize: '0.75rem' }}>
                        💬 WhatsApp
                      </a>
                    )}
                    {p.email && (
                      <a href={`mailto:${p.email}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none', fontSize: '0.75rem' }}>
                        📧 E-mail
                      </a>
                    )}
                    <button className="btn btn-danger btn-sm" style={{ marginLeft: 'auto', fontSize: '0.75rem' }} onClick={() => deletePerson(p.id, p.name)}>
                      🗑️ Remover
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
