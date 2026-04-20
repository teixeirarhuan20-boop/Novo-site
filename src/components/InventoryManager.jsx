import React, { useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { generateId, formatDate, normalizeText, formatCurrency } from '../utils/formatting'
import { COLOR_PALETTE, PALETTE_NAMES, nextFreeColor } from '../utils/location'
import { exportTXT, exportPDF } from '../utils/exportReport'

// Constrói a lista de cores a partir da paleta centralizada
const COLORS = COLOR_PALETTE.map((hex, i) => ({ hex, name: PALETTE_NAMES[i] }))

const EMPTY_FORM = { name: '', category: '', quantity: '', price: '', color: '' } // cor definida dinamicamente

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

  const usedColors  = useMemo(() => inventory.map(i => i.color).filter(Boolean), [inventory])
  const categories  = useMemo(() => [...new Set(inventory.map(i => i.category))], [inventory])
  const autoColor   = useMemo(() => nextFreeColor(usedColors), [usedColors])

  // Garante que o form sempre tenha a próxima cor livre quando está vazio
  const formColor = form.color || autoColor

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
          : qtyFilter === 'low_stock' ? q > 0 && q < 10
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
      quantity: Number(form.quantity), price: Number(form.price),
      color: formColor, // usa a cor auto-atribuída ou escolhida pelo usuário
    }

    setInventory(prev => [...prev, newItem])
    setForm(EMPTY_FORM) // ao limpar, o próximo autoColor já exclui a cor recém usada

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
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1>📦 Controle de Estoque</h1>
            <p>Gerencie produtos, preços e monitore a curva ABCD</p>
          </div>
          {/* ── Botões de Exportação ── */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Exportar:
            </span>
            <button
              type="button"
              onClick={() => exportTXT(inventory, 'Estoque')}
              title="Baixar relatório em texto simples"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '0.4rem 0.85rem', borderRadius: 8,
                border: '1.5px solid #e2e8f0', background: '#f8fafc',
                color: '#374151', fontSize: '0.78rem', fontWeight: 700,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.color = '#2563eb' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#374151' }}
            >
              📄 TXT
            </button>
            <button
              type="button"
              onClick={() => exportPDF(inventory, 'Estoque')}
              title="Abrir relatório para imprimir ou salvar como PDF"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '0.4rem 0.85rem', borderRadius: 8,
                border: '1.5px solid #2563eb', background: '#2563eb',
                color: '#fff', fontSize: '0.78rem', fontWeight: 700,
                cursor: 'pointer', transition: 'all 0.15s',
                boxShadow: '0 2px 6px rgba(37,99,235,0.3)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#1d4ed8' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#2563eb' }}
            >
              📑 PDF
            </button>
          </div>
        </div>
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
            <div className="form-group" style={{ maxWidth: 200 }}>
              <label>Cor no Mapa</label>
              <div className="flex gap-1" style={{ alignItems: 'center' }}>
                <select
                  value={formColor}
                  onChange={e => setForm(p => ({ ...p, color: e.target.value }))}
                  style={{ flex: 1 }}
                >
                  {/* Cor auto-atribuída no topo */}
                  <option value={autoColor}>⚡ Auto ({PALETTE_NAMES[COLOR_PALETTE.indexOf(autoColor)]})</option>
                  {/* Outras cores livres */}
                  {COLORS.filter(c => !usedColors.includes(c.hex) && c.hex !== autoColor).map(c => (
                    <option key={c.hex} value={c.hex}>{c.name}</option>
                  ))}
                </select>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: formColor, border: '2px solid var(--border)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                }} />
              </div>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-faint)', marginTop: '0.15rem' }}>
                Cor única gerada automaticamente
              </span>
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
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="empty-state">Nenhum produto encontrado.</td></tr>
            ) : filtered.map(item => (
              <tr key={item.id}>
                {editId === item.id ? (
                  <>
                    <td>
                      <select value={editForm.color} onChange={e => setEditForm(p => ({ ...p, color: e.target.value }))} className="inline-input" style={{ width: 160 }}>
                        {COLORS.filter(c => c.hex === item.color || !usedColors.includes(c.hex)).map(c => (
                          <option key={c.hex} value={c.hex}>{c.name}{c.hex === item.color ? ' ✓ (atual)' : ''}</option>
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
                      <span className={`badge ${Number(item.quantity) === 0 ? 'badge-red' : Number(item.quantity) < 10 ? 'badge-orange' : 'badge-green'}`}>
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
    </div>
  )
}
