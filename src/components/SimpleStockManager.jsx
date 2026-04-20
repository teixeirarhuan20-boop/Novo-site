/**
 * SimpleStockManager — componente genérico reutilizável para Vidros e Peças.
 * Usado por: GlassManager (tableName='vidros') e PartsManager (tableName='pecas')
 *
 * Tabelas necessárias no Supabase (rodar uma vez no SQL Editor):
 * ─────────────────────────────────────────────────────────────────
 * create table public.vidros (
 *   id text primary key,
 *   nome text not null,
 *   tamanho text default '',
 *   quantidade integer default 0,
 *   created_at timestamptz default now()
 * );
 * alter table public.vidros enable row level security;
 * create policy "Allow all" on public.vidros for all using (true);
 *
 * create table public.pecas (
 *   id text primary key,
 *   nome text not null,
 *   tamanho text default '',
 *   quantidade integer default 0,
 *   created_at timestamptz default now()
 * );
 * alter table public.pecas enable row level security;
 * create policy "Allow all" on public.pecas for all using (true);
 * ─────────────────────────────────────────────────────────────────
 */
import React, { useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { generateId, normalizeText } from '../utils/formatting'
import { exportTXT, exportPDF } from '../utils/exportReport'

// ─── Helpers de estilo ────────────────────────────────────────────────────────
const QTY_CFG = {
  zero: { label: 'Sem Estoque', bg: '#fee2e2', color: '#dc2626', border: '#fecaca' },
  low:  { label: 'Estoque Baixo', bg: '#fef3c7', color: '#d97706', border: '#fde68a' },
  ok:   { label: 'Em Estoque', bg: '#dcfce7', color: '#16a34a', border: '#bbf7d0' },
}

function qtyConfig(qty) {
  const q = Number(qty)
  if (q === 0) return QTY_CFG.zero
  if (q < 10)  return QTY_CFG.low
  return QTY_CFG.ok
}

const EMPTY = { nome: '', tamanho: '', quantidade: '' }

// ─── Componente principal ─────────────────────────────────────────────────────
export function SimpleStockManager({
  title,
  subtitle,
  icon,
  accentColor = '#2563eb',
  tableName,
  items,
  setItems,
  addToast,
}) {
  const [form,     setForm]     = useState(EMPTY)
  const [editId,   setEditId]   = useState(null)
  const [editForm, setEditForm] = useState(EMPTY)
  const [search,   setSearch]   = useState('')
  const [qtyFilter,setQtyFilter]= useState('all')
  const [sortBy,   setSortBy]   = useState('nome')
  const [saving,   setSaving]   = useState(false)

  // ── Filtro + Ordenação ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const tokens = normalizeText(search).split(/\s+/).filter(Boolean)
    return items
      .filter(item => {
        const haystack = normalizeText(`${item.nome} ${item.tamanho || ''}`)
        const matchSearch = tokens.every(t => haystack.includes(t))
        const q = Number(item.quantidade)
        const matchQty = qtyFilter === 'all' ? true
          : qtyFilter === 'in_stock'  ? q > 0
          : qtyFilter === 'low_stock' ? q > 0 && q < 10
          : q === 0
        return matchSearch && matchQty
      })
      .sort((a, b) => {
        if (sortBy === 'nome')      return (a.nome || '').localeCompare(b.nome || '')
        if (sortBy === 'quantidade') return Number(b.quantidade) - Number(a.quantidade)
        return 0
      })
  }, [items, search, qtyFilter, sortBy])

  // ── Contadores de sumário ──────────────────────────────────────────────────
  const totalQty    = useMemo(() => items.reduce((s, i) => s + Number(i.quantidade || 0), 0), [items])
  const lowCount    = useMemo(() => items.filter(i => Number(i.quantidade) > 0 && Number(i.quantidade) < 10).length, [items])
  const zeroCount   = useMemo(() => items.filter(i => Number(i.quantidade) === 0).length, [items])

  // ── Adicionar ──────────────────────────────────────────────────────────────
  const addItem = useCallback(async (e) => {
    e.preventDefault()
    if (!form.nome.trim() || form.quantidade === '') return
    setSaving(true)
    const newItem = {
      id: generateId(),
      nome: form.nome.trim(),
      tamanho: form.tamanho.trim(),
      quantidade: Number(form.quantidade),
    }
    setItems(prev => [...prev, newItem])
    setForm(EMPTY)
    try {
      const { error } = await supabase.from(tableName).insert([newItem])
      if (error) throw error
      addToast(`"${newItem.nome}" adicionado ao estoque!`, 'success')
    } catch (err) {
      setItems(prev => prev.filter(i => i.id !== newItem.id))
      addToast(`Erro ao salvar: ${err.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }, [form, tableName, setItems, addToast])

  // ── Salvar edição ──────────────────────────────────────────────────────────
  const saveEdit = useCallback(async (id) => {
    const updated = {
      nome:       editForm.nome.trim(),
      tamanho:    editForm.tamanho.trim(),
      quantidade: Number(editForm.quantidade),
    }
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updated } : i))
    setEditId(null)
    try {
      const { error } = await supabase.from(tableName).update(updated).eq('id', id)
      if (error) throw error
      addToast('Item atualizado!', 'success')
    } catch (err) {
      addToast(`Erro ao atualizar: ${err.message}`, 'error')
    }
  }, [editForm, tableName, setItems, addToast])

  // ── Excluir ────────────────────────────────────────────────────────────────
  const deleteItem = useCallback(async (id, nome) => {
    if (!window.confirm(`Excluir "${nome}"?`)) return
    setItems(prev => prev.filter(i => i.id !== id))
    const { error } = await supabase.from(tableName).delete().eq('id', id)
    if (error) addToast(`Erro ao excluir: ${error.message}`, 'error')
    else addToast(`"${nome}" removido.`, 'info')
  }, [tableName, setItems, addToast])

  const startEdit = useCallback((item) => {
    setEditId(item.id)
    setEditForm({ nome: item.nome || '', tamanho: item.tamanho || '', quantidade: item.quantidade ?? '' })
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="page" style={{ maxWidth: 1100, margin: '0 auto', background: '#f8fafc', minHeight: '100vh' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.4rem' }}>
        <div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.3px' }}>
            {icon} {title}
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.78rem', margin: '0.2rem 0 0' }}>{subtitle}</p>
        </div>
        {/* ── Botões de Exportação ── */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Exportar:
          </span>
          <button
            type="button"
            onClick={() => exportTXT(items, title)}
            title="Baixar relatório em texto simples"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '0.4rem 0.85rem', borderRadius: 8,
              border: '1.5px solid #e2e8f0', background: '#f8fafc',
              color: '#374151', fontSize: '0.78rem', fontWeight: 700,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.color = accentColor }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#374151' }}
          >
            📄 TXT
          </button>
          <button
            type="button"
            onClick={() => exportPDF(items, title)}
            title="Abrir relatório para imprimir ou salvar como PDF"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '0.4rem 0.85rem', borderRadius: 8,
              border: `1.5px solid ${accentColor}`, background: accentColor,
              color: '#fff', fontSize: '0.78rem', fontWeight: 700,
              cursor: 'pointer', transition: 'all 0.15s',
              boxShadow: `0 2px 6px ${accentColor}50`,
            }}
          >
            📑 PDF
          </button>
        </div>
      </div>

      {/* ── Cards de Resumo ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.85rem', marginBottom: '1.3rem' }}>
        {[
          { icon: '📦', label: 'Itens Cadastrados', value: items.length, color: accentColor,  bg: `${accentColor}12`, border: `${accentColor}40` },
          { icon: '🔢', label: 'Total em Estoque',  value: totalQty,     color: '#16a34a', bg: '#dcfce7', border: '#bbf7d0' },
          { icon: '⚠️', label: 'Estoque Baixo',     value: lowCount,     color: '#d97706', bg: '#fef3c7', border: '#fde68a' },
          { icon: '❌', label: 'Sem Estoque',        value: zeroCount,    color: '#dc2626', bg: '#fee2e2', border: '#fecaca' },
        ].map(c => (
          <div key={c.label} style={{
            background: c.bg, borderRadius: 14, padding: '0.95rem 1.1rem',
            border: `1.5px solid ${c.border}`, display: 'flex', flexDirection: 'column', gap: '0.2rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: '1.05rem' }}>{c.icon}</span>
              <span style={{ fontSize: '1.6rem', fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.value}</span>
            </div>
            <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{c.label}</span>
          </div>
        ))}
      </div>

      {/* ── Formulário de Cadastro ── */}
      <div style={{
        background: '#fff', borderRadius: 16, padding: '1.25rem 1.5rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '1.1rem',
        borderTop: `3px solid ${accentColor}`,
      }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '0.73rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
          ＋ Novo Item
        </h3>
        <form onSubmit={addItem}>
          <div className="form-row" style={{ gap: '0.75rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 3, marginBottom: 0 }}>
              <label>Nome do Item *</label>
              <input
                type="text"
                value={form.nome}
                onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
                placeholder={`Ex: ${tableName === 'vidros' ? 'Vidro Temperado' : 'Dobradiça'}`}
                required
              />
            </div>
            <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
              <label>Tamanho / Especificação</label>
              <input
                type="text"
                value={form.tamanho}
                onChange={e => setForm(p => ({ ...p, tamanho: e.target.value }))}
                placeholder={`Ex: ${tableName === 'vidros' ? '60x80cm' : 'M6 x 30mm'}`}
              />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: 90, maxWidth: 130, marginBottom: 0 }}>
              <label>Quantidade *</label>
              <input
                type="number"
                value={form.quantidade}
                onChange={e => setForm(p => ({ ...p, quantidade: e.target.value }))}
                placeholder="0"
                min="0"
                required
              />
            </div>
            <div style={{ marginBottom: 0, flexShrink: 0 }}>
              <button
                type="submit"
                disabled={saving}
                style={{
                  padding: '0.55rem 1.25rem', borderRadius: 9, border: 'none',
                  background: accentColor, color: '#fff', fontSize: '0.85rem',
                  fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                  boxShadow: `0 2px 8px ${accentColor}40`,
                  opacity: saving ? 0.7 : 1, whiteSpace: 'nowrap',
                }}
              >
                {saving ? '⏳' : '+ Adicionar'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* ── Filtros ── */}
      <div style={{
        background: '#fff', borderRadius: 14, padding: '0.75rem 1rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '0.85rem',
        display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center',
      }}>
        {/* Busca */}
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>🔍</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou tamanho..."
            style={{
              width: '100%', background: '#f8fafc',
              border: `1.5px solid ${search ? accentColor : '#e2e8f0'}`,
              borderRadius: 8, padding: '0.4rem 0.7rem 0.4rem 32px',
              fontSize: '0.79rem', outline: 'none', boxSizing: 'border-box',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '0.9rem', padding: 0 }}>✕</button>
          )}
        </div>

        {/* Qtd filter */}
        <select
          value={qtyFilter}
          onChange={e => setQtyFilter(e.target.value)}
          style={{ fontSize: '0.78rem', padding: '0.4rem 0.65rem', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', outline: 'none' }}
        >
          <option value="all">📦 Todos</option>
          <option value="in_stock">✅ Em Estoque</option>
          <option value="low_stock">⚠️ Estoque Baixo</option>
          <option value="out_stock">❌ Sem Estoque</option>
        </select>

        {/* Ordenação */}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          style={{ fontSize: '0.78rem', padding: '0.4rem 0.65rem', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', outline: 'none' }}
        >
          <option value="nome">🔤 A → Z</option>
          <option value="quantidade">📊 Maior Qtd</option>
        </select>

        <span style={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 600, marginLeft: 'auto' }}>
          {filtered.length} item{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Tabela ── */}
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>

        {/* Cabeçalho da tabela */}
        <div style={{ padding: '0.75rem 1.2rem', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
            {icon} {title}
          </span>
        </div>

        {items.length === 0 ? (
          /* Estado vazio — banco pode não ter a tabela ainda */
          <div style={{ padding: '3.5rem 1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.8rem', marginBottom: '0.6rem' }}>{icon}</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#374151', marginBottom: '0.35rem' }}>
              Nenhum item cadastrado ainda
            </div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>
              Use o formulário acima para adicionar o primeiro item.
              Certifique-se de que a tabela <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace' }}>{tableName}</code> existe no Supabase.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Nenhum item encontrado para essa busca</div>
            <button
              onClick={() => { setSearch(''); setQtyFilter('all') }}
              style={{ marginTop: '0.65rem', padding: '0.35rem 0.9rem', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontSize: '0.75rem', color: accentColor, fontWeight: 600 }}
            >Limpar filtros</button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  {['#', 'Nome', 'Tamanho', 'Quantidade', 'Ações'].map(h => (
                    <th key={h} style={{
                      padding: '0.65rem 0.85rem', textAlign: 'left',
                      fontSize: '0.67rem', fontWeight: 800, color: '#94a3b8',
                      textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => {
                  const cfg = qtyConfig(item.quantidade)
                  const isEditing = editId === item.id
                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        borderLeft: `3px solid ${isEditing ? accentColor : 'transparent'}`,
                        background: isEditing ? `${accentColor}08` : undefined,
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => !isEditing && (e.currentTarget.style.background = '#fafafa')}
                      onMouseLeave={e => !isEditing && (e.currentTarget.style.background = '')}
                    >
                      {/* Número */}
                      <td style={{ padding: '0.7rem 0.85rem', fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 700, width: 40 }}>
                        {idx + 1}
                      </td>

                      {/* Nome */}
                      <td style={{ padding: '0.7rem 0.85rem', maxWidth: 260 }}>
                        {isEditing ? (
                          <input
                            className="inline-input"
                            value={editForm.nome}
                            onChange={e => setEditForm(p => ({ ...p, nome: e.target.value }))}
                            style={{ width: '100%', minWidth: 140 }}
                            autoFocus
                          />
                        ) : (
                          <span style={{ fontWeight: 600, fontSize: '0.84rem', color: '#0f172a' }}>{item.nome}</span>
                        )}
                      </td>

                      {/* Tamanho */}
                      <td style={{ padding: '0.7rem 0.85rem' }}>
                        {isEditing ? (
                          <input
                            className="inline-input"
                            value={editForm.tamanho}
                            onChange={e => setEditForm(p => ({ ...p, tamanho: e.target.value }))}
                            placeholder="Ex: 60x80cm"
                            style={{ width: 120 }}
                          />
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: item.tamanho ? '#374151' : '#cbd5e1' }}>
                            {item.tamanho || '—'}
                          </span>
                        )}
                      </td>

                      {/* Quantidade */}
                      <td style={{ padding: '0.7rem 0.85rem' }}>
                        {isEditing ? (
                          <input
                            className="inline-input"
                            type="number"
                            value={editForm.quantidade}
                            onChange={e => setEditForm(p => ({ ...p, quantidade: e.target.value }))}
                            min="0"
                            style={{ width: 80 }}
                          />
                        ) : (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '3px 10px', borderRadius: 99,
                            background: cfg.bg, border: `1.5px solid ${cfg.border}`,
                            color: cfg.color, fontSize: '0.76rem', fontWeight: 700,
                          }}>
                            {Number(item.quantidade)} un.
                          </span>
                        )}
                      </td>

                      {/* Ações */}
                      <td style={{ padding: '0.7rem 0.85rem' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 5 }}>
                            <button
                              onClick={() => saveEdit(item.id)}
                              style={{ padding: '4px 12px', borderRadius: 7, border: '1px solid #bbf7d0', background: '#dcfce7', color: '#16a34a', fontSize: '0.77rem', fontWeight: 700, cursor: 'pointer' }}
                            >✓ Salvar</button>
                            <button
                              onClick={() => setEditId(null)}
                              style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#64748b', fontSize: '0.77rem', fontWeight: 600, cursor: 'pointer' }}
                            >✕</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 5 }}>
                            <button
                              onClick={() => startEdit(item)}
                              style={{ padding: '4px 11px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#374151', fontSize: '0.77rem', fontWeight: 600, cursor: 'pointer' }}
                            >✏️ Editar</button>
                            <button
                              onClick={() => deleteItem(item.id, item.nome)}
                              style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', fontSize: '0.77rem', fontWeight: 600, cursor: 'pointer' }}
                            >🗑️</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
