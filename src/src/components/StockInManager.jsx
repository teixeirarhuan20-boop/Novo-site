import React, { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { geocode, packLocation } from '../utils/location'
import { generateId, formatDate, normalizeText } from '../utils/formatting'

export function StockInManager({ inventory, setInventory, pessoas, transactions, setTransactions, addToast }) {
  const [actions,    setActions]    = useState({})
  const [search,     setSearch]     = useState('')
  const [catFilter,  setCatFilter]  = useState('')
  const [qtyFilter,  setQtyFilter]  = useState('all')

  const categories = useMemo(() => [...new Set(inventory.map(i => i.category))], [inventory])

  const setAction = (id, field, value) =>
    setActions(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))

  const handleTransaction = async (item, type) => {
    const action = actions[item.id] || {}
    const qty    = Number(action.quantity || 0)
    if (qty <= 0) { addToast('Informe uma quantidade válida.', 'warning'); return }
    if (type === 'saida' && qty > Number(item.quantity)) {
      addToast(`Estoque insuficiente! Disponível: ${item.quantity}`, 'error'); return
    }

    const pessoa   = pessoas.find(p => p.id === action.pessoaId)
    const locInput = action.location || ''
    let geo = null
    if (type === 'saida' && locInput) geo = await geocode(locInput)

    const city       = geo?.city || locInput.split(',')[0].trim()
    const packedName = type === 'saida' && locInput
      ? packLocation(item.name, { city, lat: geo?.lat, lng: geo?.lng })
      : item.name

    const newQty = type === 'entrada'
      ? Number(item.quantity) + qty
      : Number(item.quantity) - qty

    const tx = {
      id: generateId(), type: type === 'entrada' ? 'entrada' : 'saída',
      itemId: item.id, itemName: packedName, city,
      quantity: qty, unitPrice: item.price,
      totalValue: item.price * qty,
      personName: pessoa?.name || '',
      date: formatDate(),
    }

    setInventory(prev => prev.map(i => i.id === item.id ? { ...i, quantity: newQty } : i))
    setTransactions(prev => [...prev, tx])
    setActions(prev => ({ ...prev, [item.id]: { quantity: '', pessoaId: '', location: '' } }))

    await Promise.all([
      supabase.from('inventory').update({ quantity: newQty }).eq('id', item.id),
      supabase.from('transactions').insert([tx]),
    ])

    addToast(`${type === 'entrada' ? 'Entrada' : 'Saída'} de ${qty}x "${item.name}" registrada!`, 'success')
  }

  const filtered = useMemo(() => {
    const tokens = normalizeText(search).split(/\s+/).filter(Boolean)
    return inventory.filter(item => {
      const content  = normalizeText(`${item.name} ${item.category}`)
      const matchS   = tokens.every(t => content.includes(t))
      const matchC   = !catFilter || item.category === catFilter
      const q        = Number(item.quantity)
      const matchQ   = qtyFilter === 'all' ? true
        : qtyFilter === 'in_stock'  ? q > 0
        : qtyFilter === 'low_stock' ? q > 0 && q < 5
        : q === 0
      return matchS && matchC && matchQ
    })
  }, [inventory, search, catFilter, qtyFilter])

  return (
    <div className="page">
      <div className="page-header">
        <h1>🔁 Movimentações</h1>
        <p>Entradas manuais, ajustes de estoque e reposições</p>
      </div>

      <div className="filters">
        <input className="search-input" type="text" placeholder="🔍 Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} />
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="">📂 Todas</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={qtyFilter} onChange={e => setQtyFilter(e.target.value)}>
          <option value="all">📦 Todos</option>
          <option value="in_stock">✅ Em Estoque</option>
          <option value="low_stock">⚠️ Baixo</option>
          <option value="out_stock">❌ Zerado</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Produto</th><th>Estoque</th><th>Qtde</th><th>Pessoa / Local (saída)</th><th>Ação</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="empty-state">Nenhum produto encontrado.</td></tr>
            ) : filtered.map(item => {
              const a = actions[item.id] || {}
              return (
                <tr key={item.id}>
                  <td className="font-medium">{item.name}</td>
                  <td>
                    <span className={`badge ${Number(item.quantity) === 0 ? 'badge-red' : Number(item.quantity) < 5 ? 'badge-orange' : 'badge-green'}`}>
                      {item.quantity} un.
                    </span>
                  </td>
                  <td>
                    <input className="inline-input" type="number" placeholder="Qtd." value={a.quantity || ''} onChange={e => setAction(item.id, 'quantity', e.target.value)} min="1" style={{ width: 70 }} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <select className="inline-input" value={a.pessoaId || ''} onChange={e => setAction(item.id, 'pessoaId', e.target.value)} style={{ width: 160 }}>
                        <option value="">-- Ninguém --</option>
                        {pessoas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input className="inline-input" type="text" placeholder="Cidade/CEP (saída)" value={a.location || ''} onChange={e => setAction(item.id, 'location', e.target.value)} style={{ width: 160, fontSize: '0.78rem' }} />
                    </div>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button className="btn btn-success btn-sm" onClick={() => handleTransaction(item, 'entrada')}>+ Entrada</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleTransaction(item, 'saida')}>− Saída</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
