import React, { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { unpackLocation } from '../utils/location'
import { formatCurrency } from '../utils/formatting'

export function HistoryManager({ transactions, setTransactions, inventory, setInventory, addToast }) {
  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [page,       setPage]       = useState(1)
  const PER_PAGE = 20

  const filtered = useMemo(() => {
    const list = [...transactions].sort((a, b) => b.id.localeCompare(a.id))
    return list.filter(t => {
      const matchType = typeFilter === 'all' || t.type === typeFilter
      const cleanName = t.itemName?.split('||')[0]?.trim() || ''
      const matchSearch = !search ||
        cleanName.toLowerCase().includes(search.toLowerCase()) ||
        t.personName?.toLowerCase().includes(search.toLowerCase())
      return matchType && matchSearch
    })
  }, [transactions, typeFilter, search])

  const pages    = Math.ceil(filtered.length / PER_PAGE)
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const totalIn  = useMemo(() => transactions.filter(t => t.type === 'entrada').reduce((s, t) => s + Number(t.totalValue || 0), 0), [transactions])
  const totalOut = useMemo(() => transactions.filter(t => t.type === 'saída').reduce((s, t) => s + Number(t.totalValue || 0), 0), [transactions])

  const deleteTransaction = async (tx) => {
    if (!window.confirm('Remover esta transação? O estoque será recalculado.')) return
    const item = inventory.find(i => i.id === tx.itemId)
    if (item) {
      const newQty = tx.type === 'saída'
        ? Number(item.quantity) + Number(tx.quantity)
        : Math.max(0, Number(item.quantity) - Number(tx.quantity))
      setInventory(prev => prev.map(i => i.id === item.id ? { ...i, quantity: newQty } : i))
      await supabase.from('inventory').update({ quantity: newQty }).eq('id', item.id)
    }
    setTransactions(prev => prev.filter(t => t.id !== tx.id))
    await supabase.from('transactions').delete().eq('id', tx.id)
    addToast('Transação removida e estoque recalculado.', 'success')
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>📜 Histórico</h1>
        <p>Todas as movimentações de estoque</p>
      </div>

      <div className="stat-grid mb-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <span className="stat-label">Total de Registros</span>
          <span className="stat-value">{transactions.length}</span>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid var(--success)' }}>
          <span className="stat-label">Total Entradas</span>
          <span className="stat-value color-green" style={{ fontSize: '1.3rem' }}>{formatCurrency(totalIn)}</span>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid var(--primary)' }}>
          <span className="stat-label">Total Saídas (Faturado)</span>
          <span className="stat-value color-blue" style={{ fontSize: '1.3rem' }}>{formatCurrency(totalOut)}</span>
        </div>
      </div>

      <div className="filters">
        <input className="search-input" type="text" placeholder="🔍 Produto ou cliente..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1) }}>
          <option value="all">Todos os Tipos</option>
          <option value="entrada">✅ Entradas</option>
          <option value="saída">🔻 Saídas</option>
        </select>
        <span className="text-muted text-small">{filtered.length} registro(s)</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Data</th><th>Tipo</th><th>Produto</th><th>Destino</th><th>Cliente</th><th>Qtd</th><th>Total</th><th></th></tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr><td colSpan={8} className="empty-state">Nenhum registro encontrado.</td></tr>
            ) : paginated.map(t => {
              const loc = unpackLocation(t.itemName)
              return (
                <tr key={t.id}>
                  <td className="text-small text-muted">{t.date?.split(' ')[0]}</td>
                  <td>
                    <span className={`badge ${t.type === 'entrada' ? 'badge-green' : 'badge-blue'}`}>
                      {t.type === 'entrada' ? '⬆ Entrada' : '⬇ Saída'}
                    </span>
                  </td>
                  <td className="font-medium">{loc?.cleanName || t.itemName?.split('||')[0]?.trim()}</td>
                  <td className="text-small text-muted">{loc?.city || t.city || '—'}</td>
                  <td>{t.personName || '—'}</td>
                  <td>{t.quantity}</td>
                  <td className={`font-bold ${t.type === 'saída' ? 'color-green' : 'text-muted'}`}>{formatCurrency(t.totalValue)}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => deleteTransaction(t)}>✕</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex gap-1 mt-2" style={{ justifyContent: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹ Anterior</button>
          <span className="text-muted" style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>Pág. {page} / {pages}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}>Próxima ›</button>
        </div>
      )}
    </div>
  )
}