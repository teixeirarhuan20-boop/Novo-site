import React, { useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { generateId, formatDate, normalizeText, formatCurrency } from '../utils/formatting'

const COLORS = [
  { name: 'Azul Real',       hex: '#2563eb' }, { name: 'Verde Esmeralda', hex: '#16a34a' },
  { name: 'Laranja Vibrante',hex: '#d97706' }, { name: 'Vermelho Fogo',   hex: '#dc2626' },
  { name: 'Roxo Profundo',   hex: '#7c3aed' }, { name: 'Ciano Marinho',   hex: '#0891b2' },
  { name: 'Rosa Choque',     hex: '#db2777' }, { name: 'Cinza Ardósia',   hex: '#4b5563' },
  { name: 'Verde Floresta',  hex: '#059669' }, { name: 'Âmbar Sol',       hex: '#b45309' },
  { name: 'Índigo Noturno',  hex: '#4338ca' }, { name: 'Lima Limão',      hex: '#84cc16' },
]

const EMPTY_FORM = { name: '', category: '', quantity: '', price: '', color: COLORS[0].hex }

function CurveBadge({ curve }) {
  const labels = { A: 'Curva A', B: 'Curva B', C: 'Curva C', D: 'Curva D' }
  return (
    <span className={`badge curve-${curve}`} title="Baseado no volume de movimentação">
      {labels[curve] || 'D'}
    </span>
  )
}

export function InventoryManager({ inventory, setInventory, transactions, setTransactions, addToast }) {
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [editId,    setEditId]    = useState(null)
  const [editForm,  setEditForm]  = useState(EMPTY_FORM)
  const [search,    setSearch]    = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [qtyFilter, setQtyFilter] = useState('all')
  const [sortBy,    setSortBy]    = useState('name')

  const usedColors = useMemo(() => inventory.map(i => i.color).filter(Boolean), [inventory])
  const categories = useMemo(() => [...new Set(inventory.map(i => i.category))], [inventory])

  // Curva ABCD
  const curves = useMemo(() => {
    const flow = {}
    transactions.forEach(t => {
      flow[t.itemId] = (flow[t.itemId] || 0) + Number(t.quantity)
    })
    const sorted = inventory.map(i => ({ id: i.id, flow: flow[i.id] || 0 }))
      .sort((a, b) => b.flow - a.flow)
    const withFlow = sorted.filter(i => i.flow > 0).length
    const result = {}
    sorted.forEach((item, idx) => {
      if (item.flow === 0) { result[item.id] = 'D'; return }
      const pct = (idx + 1) / (withFlow || 1)
      result[item.id] = pct <= 0.25 ? 'A' : pct <= 0.50 ? 'B' : pct <= 0.75 ? 'C' : 'D'
    })
    return result
  }, [inventory, transactions])

  const filtered = useMemo(() => {
    const tokens = normalizeText(search).split(/\s+/).filter(Boolean)
    return inventory
      .filter(item => {
        const content = normalizeText(`${item.name} ${item.category}`)
        const matchSearch = tokens.every(t => content.includes(t))
        const matchCat    = !catFilter || item.category === catFilter
        const q = Number(item.quantity)
        const matchQty    = qtyFilter === 'all' ? true
          : qtyFilter === 'in_stock'  ? q > 0
          : qtyFilter === 'low_stock' ? q > 0 && q < 5
          : q === 0
        return matchSearch && matchCat && matchQty
      })
      .sort((a, b) => {
        if (sortBy === 'name')     return a.name.localeCompare(b.name)
        if (sortBy === 'quantity') return Number(b.quantity) - Number(a.quantity)
        if (sortBy === 'price')    return Number(b.price) - Number(a.price)
        return 0
      })
  }, [inventory, search, catFilter, qtyFilter, sortBy])

  const addItem = useCallback(async (e) => {
    e.preventDefault()
    if (!form.name || !form.quantity || !form.price || !form.category) return

    const newItem = {
      id: generateId(), name: form.name, category: form.category,
      quantity: Number(form.quantity), price: Number(form.price), color: form.color,
    }

    setInventory(prev => [...prev, newItem])
    setForm(EMPTY_FORM)

    try {
      const { error } = await supabase.from('inventory').insert([newItem])
      if (error) throw error

      if (newItem.quantity > 0) {
        const tx = {
          id: generateId(), type: 'entrada', itemId: newItem.id, itemName: newItem.name,
          quantity: newItem.quantity, unitPrice: newItem.price,
          totalValue: newItem.price * newItem.quantity,
          personName: 'Sistema (Cadastro)', date: formatDate(),
        }
        setTransactions(prev => [...prev, tx])
        await supabase.from('transactions').insert([tx])
      }
      addToast(`Produto "${newItem.name}" adicionado!`, 'success')
    } catch (err) {
      setInventory(prev => prev.filter(i => i.id !== newItem.id))
      addToast(`Erro: ${err.message}`, 'error')
    }
  }, [form, setInventory, setTransactions, addToast])

  const deleteItem = useCallback(async (id, name) => {
    setInventory(prev => prev.filter(i => i.id !== id))
    const { error } = await supabase.from('inventory').delete().eq('id', id)
    if (error) addToast(`Erro ao excluir: ${error.message}`, 'error')
    else addToast(`"${name}" removido.`, 'success')
  }, [setInventory, addToast])

  const saveEdit = useCallback(async (id) => {
    const updated = { name: editForm.name, category: editForm.category, quantity: Number(editForm.quantity), price: Number(editForm.price), color: editForm.color }
    setInventory(prev => prev.map(i => i.id === id ? { ...i, ...updated } : i))
    setEditId(null)
    const { error } = await supabase.from('inventory').update(updated).eq('id', id)
    if (error) addToast(`Erro ao salvar: ${error.message}`, 'error')
    else addToast('Produto atualizado!', 'success')
  }, [editForm, setInventory, addToast])

  return (
    <div className="page">
      <div className="page-header">
        <h1>📦 Controle de Estoque</h1>
        <p>Gerencie produtos, preços e monitore a curva ABCD</p>
      </div>

      {/* Formulário de adição */}
      <div className="card mb-3">
        <h3 style={{ marginBottom: '1rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          + Novo Produto
        </h3>
        <form onSubmit={addItem}>
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>Nome do Produto</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Monitor Dell 24" required />
            </div>
            <div className="form-group">
              <label>Categoria</label>
              <input type="text" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="Ex: Eletrônicos" required />
            </div>
            <div className="form-group" style={{ maxWidth: 100 }}>
              <label>Qtde</label>
              <input type="number" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} placeholder="0" min="0" required />
            </div>
            <div className="form-group" style={{ maxWidth: 130 }}>
              <label>Preço (R$)</label>
              <input type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} placeholder="0.00" step="0.01" min="0" required />
            </div>
            <div className="form-group" style={{ maxWidth: 180 }}>
              <label>Cor no Mapa</label>
              <div className="flex gap-1" style={{ alignItems: 'center' }}>
                <select value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} style={{ flex: 1 }}>
                  {COLORS.filter(c => !usedColors.includes(c.hex)).map(c => (
                    <option key={c.hex} value={c.hex}>{c.name}</option>
                  ))}
                </select>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: form.color, border: '2px solid var(--border)', flexShrink: 0 }} />
              </div>
            </div>
            <div className="form-group" style={{ justifyContent: 'flex-end', flex: 0 }}>
              <button type="submit" className="btn btn-primary">Adicionar</button>
            </div>
          </div>
        </form>
      </div>

      {/* Filtros */}
      <div className="filters">
        <input className="search-input" type="text" placeholder="🔍 Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} />
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="">📂 Todas Categorias</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={qtyFilter} onChange={e => setQtyFilter(e.target.value)}>
          <option value="all">📦 Todos</option>
          <option value="in_stock">✅ Em Estoque</option>
          <option value="low_stock">⚠️ Estoque Baixo</option>
          <option value="out_stock">❌ Sem Estoque</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="name">🔤 A-Z</option>
          <option value="quantity">📊 Maior Estoque</option>
          <option value="price">💰 Maior Valor</option>
        </select>
        <span className="text-muted text-small">{filtered.length} produto(s)</span>
      </div>

      {/* Tabela */}
      {filtered.length > 0 && (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cor</th>
              <th>Produto</th>
              <th>Curva</th>
              <th>Categoria</th>
              <th>Estoque</th>
              <th>Preço Unit.</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id}>
                {editId === item.id ? (
                  <>
                    <td>
                      <select value={editForm.color} onChange={e => setEditForm(p => ({ ...p, color: e.target.value }))} className="inline-input" style={{ width: 140 }}>
                        {COLORS.filter(c => c.hex === item.color || !usedColors.includes(c.hex)).map(c => (
                          <option key={c.hex} value={c.hex}>{c.name}{c.hex === item.color ? ' ✓' : ''}</option>
                        ))}
                      </select>
                    </td>
                    <td><input className="inline-input" value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} /></td>
                    <td><CurveBadge curve={curves[item.id] || 'D'} /></td>
                    <td><input className="inline-input" value={editForm.category} onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))} /></td>
                    <td><input className="inline-input" type="number" value={editForm.quantity} onChange={e => setEditForm(p => ({ ...p, quantity: e.target.value }))} style={{ width: 70 }} /></td>
                    <td><input className="inline-input" type="number" value={editForm.price} onChange={e => setEditForm(p => ({ ...p, price: e.target.value }))} step="0.01" style={{ width: 90 }} /></td>
                    <td className="flex gap-1">
                      <button className="btn btn-success btn-sm" onClick={() => saveEdit(item.id)}>Salvar</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditId(null)}>Cancelar</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td><div style={{ width: 14, height: 14, borderRadius: '50%', background: item.color || '#2563eb', margin: '0 auto' }} /></td>
                    <td className="font-medium">{item.name}</td>
                    <td><CurveBadge curve={curves[item.id] || 'D'} /></td>
                    <td className="text-muted">{item.category}</td>
                    <td>
                      <span className={`badge ${Number(item.quantity) === 0 ? 'badge-red' : Number(item.quantity) < 5 ? 'badge-orange' : 'badge-green'}`}>
                        {Number(item.quantity)} un.
                      </span>
                    </td>
                    <td>{formatCurrency(item.price)}</td>
                    <td className="flex gap-1">
                      <button className="btn btn-secondary btn-sm" onClick={() => { setEditId(item.id); setEditForm({ name: item.name, category: item.category, quantity: item.quantity, price: item.price, color: item.color }) }}>Editar</button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteItem(item.id)}>Excluir</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}