import React, { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { generateId, formatDate, normalizeText, formatCurrency } from '../utils/formatting'

const EMPTY = { name: '', document: '', role: 'cliente', contact: '', email: '', address: '', cep: '', city: '' }

export function PeopleManager({ pessoas, setPessoas, transactions, addToast }) {
  const [form,   setForm]   = useState(EMPTY)
  const [search, setSearch] = useState('')

  const stats = useMemo(() => {
    const map = {}
    transactions.forEach(t => {
      if (!t.personName) return
      if (!map[t.personName]) map[t.personName] = { total: 0, count: 0 }
      map[t.personName].total += Number(t.totalValue || 0)
      map[t.personName].count++
    })
    return map
  }, [transactions])

  const enriched = useMemo(() => {
    const withStats = pessoas.map(p => ({
      ...p,
      total: stats[p.name]?.total || 0,
      count: stats[p.name]?.count || 0,
    })).sort((a, b) => b.total - a.total)

    const totalRevenue = withStats.reduce((s, p) => s + p.total, 0)
    let cumulative = 0
    return withStats.map(p => {
      cumulative += p.total
      const pct = totalRevenue > 0 ? cumulative / totalRevenue : 1
      return { ...p, curve: pct <= 0.80 ? 'A' : pct <= 0.95 ? 'B' : 'C' }
    })
  }, [pessoas, stats])

  const filtered = useMemo(() => {
    const tokens = normalizeText(search).split(/\s+/).filter(Boolean)
    if (!tokens.length) return enriched
    return enriched.filter(p => {
      const content = normalizeText(`${p.name} ${p.city || ''} ${p.contact || ''}`)
      return tokens.every(t => content.includes(t))
    })
  }, [enriched, search])

  const abcSummary = ['A', 'B', 'C'].map(curve => ({
    curve,
    count: enriched.filter(p => p.curve === curve).length,
    revenue: enriched.filter(p => p.curve === curve).reduce((s, p) => s + p.total, 0),
  }))

  const curveMeta = {
    A: { bg: '#fef3c7', color: '#92400e', border: '#f59e0b', label: 'Ouro ⭐' },
    B: { bg: '#dbeafe', color: '#1e40af', border: '#3b82f6', label: 'Prata 🥈' },
    C: { bg: '#f1f5f9', color: '#475569', border: '#94a3b8', label: 'Bronze 🥉' },
  }

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

  const deletePerson = async (id, name) => {
    setPessoas(prev => prev.filter(p => p.id !== id))
    await supabase.from('pessoas').delete().eq('id', id)
    addToast(`"${name}" removido(a).`, 'success')
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>👥 Pessoas / CRM</h1>
        <p>Clientes e fornecedores com classificação ABC automática</p>
      </div>

      {/* Resumo ABC */}
      <div className="stat-grid mb-3" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        {abcSummary.map(({ curve, count, revenue }) => (
          <div key={curve} className="stat-card" style={{ borderLeft: `4px solid ${curveMeta[curve].border}` }}>
            <span className="stat-label">Curva {curve} — {curveMeta[curve].label}</span>
            <span className="stat-value">{count}</span>
            <span className="stat-sub">{formatCurrency(revenue)}</span>
          </div>
        ))}
      </div>

      {/* Formulário */}
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
            <div className="form-group" style={{ maxWidth: 150 }}>
              <label>Tipo</label>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                <option value="cliente">Cliente</option>
                <option value="fornecedor">Fornecedor</option>
                <option value="ambos">Ambos</option>
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

      {/* Lista */}
      <div className="card">
        <div className="flex-between mb-2">
          <h3 style={{ fontWeight: 600 }}>Lista ({enriched.length})</h3>
          <input type="text" placeholder="🔍 Buscar nome ou cidade..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 260 }} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Curva</th><th>Nome</th><th>Cidade</th><th>Contato</th><th>Pedidos</th><th>Total Gasto</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="empty-state">Nenhuma pessoa encontrada.</td></tr>
              ) : filtered.map(p => {
                const m = curveMeta[p.curve]
                return (
                  <tr key={p.id}>
                    <td>
                      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
                        {p.curve}
                      </span>
                    </td>
                    <td className="font-medium">{p.name}</td>
                    <td className="text-muted text-small">{p.city || '—'}</td>
                    <td className="text-small">{p.contact || p.email || '—'}</td>
                    <td className="text-center font-bold color-blue">{p.count || 0}</td>
                    <td className={`font-bold ${p.total > 0 ? 'color-green' : 'text-muted'}`}>{formatCurrency(p.total)}</td>
                    <td><button className="btn btn-danger btn-sm" onClick={() => deletePerson(p.id, p.name)}>Excluir</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
