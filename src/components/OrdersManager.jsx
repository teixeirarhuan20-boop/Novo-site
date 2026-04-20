import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { LabelAssistant } from './LabelAssistant'
import { BatchScanner } from './BatchScanner'
import { geocode, packLocation, unpackLocation, jitter } from '../utils/location'
import { generateId, formatDate, normalizeText, formatCurrency } from '../utils/formatting'
import { analyzeText, analyzeDocument } from '../lib/gemini'
import Tesseract from 'tesseract.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return new Date(0)
  const part = str.split(' ')[0] // "17/04/2026"
  const [d, m, y] = part.split('/')
  return new Date(`${y}-${m}-${d}`)
}

const STATUS_CFG = {
  pendente:   { label: 'Pendente',   color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', icon: '🕐' },
  em_envio:   { label: 'Em Envio',   color: '#d97706', bg: '#fef3c7', border: '#fde68a', icon: '🚚' },
  finalizado: { label: 'Finalizado', color: '#16a34a', bg: '#dcfce7', border: '#bbf7d0', icon: '✅' },
  problema:   { label: 'Problema',   color: '#dc2626', bg: '#fee2e2', border: '#fecaca', icon: '⚠️' },
}

// ─── Status Badge com dropdown inline ─────────────────────────────────────────
function StatusBadge({ status, onChange, compact = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const cfg = STATUS_CFG[status] || STATUS_CFG.pendente

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={e => { e.stopPropagation(); if (onChange) setOpen(v => !v) }}
        style={{
          display: 'flex', alignItems: 'center', gap: compact ? 3 : 5,
          padding: compact ? '2px 8px' : '4px 11px',
          borderRadius: 99, border: `1.5px solid ${cfg.border}`,
          background: cfg.bg, color: cfg.color,
          fontSize: compact ? '0.68rem' : '0.75rem', fontWeight: 700,
          cursor: onChange ? 'pointer' : 'default', whiteSpace: 'nowrap',
          lineHeight: 1.4,
        }}
      >
        {cfg.icon} {!compact && cfg.label} {onChange && '▾'}
      </button>
      {open && onChange && (
        <div
          style={{
            position: 'absolute', top: '110%', left: 0, zIndex: 500,
            background: '#fff', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.14)', border: '1px solid #e2e8f0',
            overflow: 'hidden', minWidth: 155,
          }}
          onClick={e => e.stopPropagation()}
        >
          {Object.entries(STATUS_CFG).map(([k, v]) => (
            <button
              key={k}
              onClick={() => { onChange(k); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '0.55rem 0.85rem', border: 'none',
                background: k === status ? v.bg : 'transparent',
                cursor: 'pointer', fontSize: '0.78rem', fontWeight: k === status ? 700 : 500,
                color: k === status ? v.color : '#374151', textAlign: 'left',
              }}
            >
              {v.icon} {v.label} {k === status && '✓'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Card de Resumo ───────────────────────────────────────────────────────────
function SummaryCard({ icon, label, value, color, bg, border, active, onClick, sub }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? bg : '#fff',
        borderRadius: 14, padding: '1rem 1.2rem',
        border: `1.5px solid ${active ? border : '#e2e8f0'}`,
        boxShadow: active ? `0 0 0 3px ${color}20, 0 2px 8px rgba(0,0,0,0.05)` : '0 1px 3px rgba(0,0,0,0.06)',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', gap: '0.2rem',
        transition: 'all 0.15s', userSelect: 'none',
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.transform = 'translateY(-2px)')}
      onMouseLeave={e => onClick && (e.currentTarget.style.transform = '')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '1.15rem' }}>{icon}</span>
        <span style={{ fontSize: '1.65rem', fontWeight: 800, color: active ? color : '#0f172a', lineHeight: 1 }}>{value}</span>
      </div>
      <span style={{ fontSize: '0.71rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</span>
      {sub && <span style={{ fontSize: '0.68rem', color: color, fontWeight: 600 }}>{sub}</span>}
    </div>
  )
}

// ─── Detalhes expandidos do pedido ───────────────────────────────────────────
function OrderDetails({ tx, loc, status, onStatusChange }) {
  const fields = [
    ['Referência / Pedido', loc?.orderId || '—'],
    ['Endereço',           loc?.address || '—'],
    ['Bairro',             loc?.bairro  || '—'],
    ['CEP',                loc?.cep     || '—'],
    ['Modalidade',         loc?.modalidade || '—'],
    ['Rastreio',           loc?.rastreio   || '—'],
    ['Preço Unitário',     formatCurrency(tx.unitPrice)],
    ['Quantidade',         `${tx.quantity} un.`],
    ['Total',              formatCurrency(tx.totalValue)],
    ['Coordenadas',        loc?.lat ? `${Number(loc.lat).toFixed(4)}, ${Number(loc.lng).toFixed(4)}` : '—'],
    ['Data',               tx.date || '—'],
    ['ID',                 tx.id || '—'],
  ]
  return (
    <div style={{ padding: '0.85rem 1rem 1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))', gap: '0.5rem', marginBottom: '0.85rem' }}>
        {fields.map(([k, v]) => (
          <div key={k} style={{ background: '#fff', borderRadius: 8, padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '0.63rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{k}</div>
            <div style={{ fontSize: '0.8rem', color: '#1e293b', fontWeight: 500, marginTop: 2, wordBreak: 'break-all' }}>{v}</div>
          </div>
        ))}
      </div>
      {/* Alterar Status inline */}
      <div style={{ background: '#fff', borderRadius: 8, padding: '0.6rem 0.85rem', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', flexShrink: 0 }}>Alterar Status:</span>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {Object.entries(STATUS_CFG).map(([k, v]) => (
            <button
              key={k}
              onClick={() => onStatusChange(k)}
              style={{
                padding: '4px 12px', borderRadius: 99,
                background: k === status ? v.bg : '#f8fafc',
                border: `1.5px solid ${k === status ? v.border : '#e2e8f0'}`,
                color: k === status ? v.color : '#64748b',
                fontSize: '0.75rem', fontWeight: k === status ? 700 : 500,
                cursor: 'pointer', transition: 'all 0.12s',
              }}
            >
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Linha de Pedido (expansível) ────────────────────────────────────────────
function OrderRow({ tx, status, expanded, onExpand, onStatusChange, onViewMap, onDelete, selected, onSelect, batchMode }) {
  const loc      = useMemo(() => unpackLocation(tx.itemName), [tx.itemName])
  const cfg      = STATUS_CFG[status] || STATUS_CFG.pendente
  const prodName = loc?.cleanName || tx.itemName?.split('||')[0]?.trim() || '—'
  const city     = loc?.city || tx.city || '—'
  const rastreio = loc?.rastreio || null
  const date     = tx.date?.split(' ')[0] || '—'

  return (
    <>
      <tr
        onClick={() => onExpand(tx.id)}
        style={{
          cursor: 'pointer',
          background: expanded ? '#f8fafc' : selected ? '#eff6ff' : undefined,
          borderBottom: '1px solid #f1f5f9',
          borderLeft: `3px solid ${cfg.color}`,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => !expanded && !selected && (e.currentTarget.style.background = '#fafafa')}
        onMouseLeave={e => !expanded && !selected && (e.currentTarget.style.background = '')}
      >
        {batchMode && (
          <td onClick={e => e.stopPropagation()} style={{ width: 38, textAlign: 'center', padding: '0.7rem 0.5rem' }}>
            <input
              type="checkbox" checked={selected}
              onChange={e => onSelect(tx.id, e.target.checked)}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#7c3aed' }}
            />
          </td>
        )}
        <td style={{ padding: '0.7rem 0.75rem', fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>{date}</td>
        <td style={{ padding: '0.7rem 0.75rem', fontWeight: 600, fontSize: '0.83rem', color: '#0f172a', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tx.personName || '—'}
        </td>
        <td style={{ padding: '0.7rem 0.75rem', fontSize: '0.8rem', color: '#334155', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {prodName}
        </td>
        <td style={{ padding: '0.7rem 0.75rem', fontSize: '0.77rem', color: '#64748b' }}>{city}</td>
        <td style={{ padding: '0.7rem 0.75rem', fontSize: '0.78rem', textAlign: 'center' }}>{tx.quantity}</td>
        <td style={{ padding: '0.7rem 0.75rem', fontSize: '0.82rem', fontWeight: 700, color: '#16a34a', whiteSpace: 'nowrap' }}>{formatCurrency(tx.totalValue)}</td>
        <td style={{ padding: '0.7rem 0.75rem' }} onClick={e => e.stopPropagation()}>
          <StatusBadge status={status} onChange={onStatusChange} compact />
        </td>
        <td style={{ padding: '0.7rem 0.75rem', fontSize: '0.7rem', color: rastreio ? '#2563eb' : '#cbd5e1', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {rastreio ? `📦 ${rastreio}` : '—'}
        </td>
        <td style={{ padding: '0.7rem 0.75rem' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'nowrap' }}>
            <button onClick={() => onViewMap(tx)} title="Ver no mapa" style={btnStyle('#e0f2fe', '#0284c7')}>🗺️</button>
            {status !== 'finalizado' && (
              <button onClick={() => onStatusChange('finalizado')} title="Finalizar pedido" style={btnStyle('#dcfce7', '#16a34a')}>✅</button>
            )}
            {status === 'pendente' && (
              <button onClick={() => onStatusChange('em_envio')} title="Marcar como enviado" style={btnStyle('#fef3c7', '#d97706')}>🚚</button>
            )}
            {status !== 'problema' && (
              <button onClick={() => onStatusChange('problema')} title="Marcar problema" style={btnStyle('#fee2e2', '#dc2626')}>⚠️</button>
            )}
            <button onClick={() => onDelete(tx.id)} title="Excluir" style={btnStyle('#fee2e2', '#dc2626', true)}>🗑️</button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <td colSpan={batchMode ? 10 : 9} style={{ padding: 0 }}>
            <OrderDetails tx={tx} loc={loc} status={status} onStatusChange={onStatusChange} />
          </td>
        </tr>
      )}
    </>
  )
}

function btnStyle(bg, color, ghost = false) {
  return {
    padding: '3px 7px', border: `1px solid ${ghost ? '#fecaca' : bg}`,
    background: ghost ? '#fff' : bg, borderRadius: 6,
    cursor: 'pointer', fontSize: '0.75rem', lineHeight: 1, flexShrink: 0,
    color: ghost ? color : undefined,
  }
}

// ─── Mapa de Pedidos ──────────────────────────────────────────────────────────
function OrdersMap({ transactions, focusTx }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const markersRef   = useRef([])
  const sales = useMemo(() => transactions.filter(t => t.type === 'saída'), [transactions])

  useEffect(() => {
    const init = () => {
      if (!containerRef.current || mapRef.current) return
      if (!window.L) { setTimeout(init, 200); return }
      mapRef.current = window.L.map(containerRef.current).setView([-15.78, -47.93], 4)
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 18,
      }).addTo(mapRef.current)
      setTimeout(() => mapRef.current?.invalidateSize(), 200)
    }
    init()
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [])

  useEffect(() => {
    if (!mapRef.current || !window.L) return
    markersRef.current.forEach(m => mapRef.current.removeLayer(m))
    markersRef.current = []
    const blueIcon = window.L.divIcon({
      html: `<div style="width:12px;height:12px;border-radius:50%;background:#3b82f6;border:2px solid #fff;box-shadow:0 1px 6px rgba(59,130,246,0.5)"></div>`,
      className: '', iconSize: [12, 12], iconAnchor: [6, 6], popupAnchor: [0, -8],
    })
    sales.forEach(t => {
      const loc = unpackLocation(t.itemName)
      if (!loc?.lat || !loc?.lng || isNaN(loc.lat)) return
      const m = window.L.marker([jitter(loc.lat), jitter(loc.lng)], { icon: blueIcon })
        .addTo(mapRef.current)
        .bindPopup(`<div style="font-family:inherit;font-size:0.8rem;min-width:160px">
          <b>${loc.cleanName || t.itemName.split('||')[0]}</b><br>
          👤 ${t.personName} · 📍 ${loc.city || '—'}<br>
          💰 <b style="color:#16a34a">${formatCurrency(t.totalValue)}</b>
          ${loc.rastreio ? `<br>📦 ${loc.rastreio}` : ''}
        </div>`)
      markersRef.current.push(m)
    })
    if (markersRef.current.length) {
      try { mapRef.current.fitBounds(window.L.featureGroup(markersRef.current).getBounds().pad(0.3)) } catch {}
    }
    setTimeout(() => mapRef.current?.invalidateSize(), 200)
  }, [sales])

  useEffect(() => {
    if (!focusTx || !mapRef.current || !window.L) return
    const loc = unpackLocation(focusTx.itemName)
    if (!loc?.lat || !loc?.lng || isNaN(loc.lat)) return
    mapRef.current.setView([loc.lat, loc.lng], 13)
  }, [focusTx])

  return <div ref={containerRef} style={{ height: 360, width: '100%', borderRadius: '0 0 14px 14px' }} />
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export function OrdersManager({ inventory, setInventory, pessoas, setPessoas, transactions, setTransactions, addToast, isActive }) {

  // ── Tabs ──
  const [pageTab, setPageTab] = useState('central')

  // ── Form state (preservado intacto) ──
  const [showLabel,      setShowLabel]      = useState(false)
  const [dragOver,       setDragOver]       = useState(false)
  const [dragProcessing, setDragProcessing] = useState(false)
  const [productSearch,  setProductSearch]  = useState('')
  const [selectedItem,   setSelectedItem]   = useState('')
  const [selectedPessoa, setSelectedPessoa] = useState('')
  const [quantity,       setQuantity]       = useState(1)
  const [location,       setLocation]       = useState('')
  const [address,        setAddress]        = useState('')
  const [bairro,         setBairro]         = useState('')
  const [orderRef,       setOrderRef]       = useState('')
  const [rastreio,       setRastreio]       = useState('')
  const [modalidade,     setModalidade]     = useState('')
  const [processing,     setProcessing]     = useState(false)

  // ── Central state ──
  const [search,         setSearch]         = useState('')
  const [filterStatus,   setFilterStatus]   = useState('all')
  const [filterCity,     setFilterCity]     = useState('all')
  const [filterProduct,  setFilterProduct]  = useState('all')
  const [filterPeriod,   setFilterPeriod]   = useState('all')
  const [expandedId,     setExpandedId]     = useState(null)
  const [selectedIds,    setSelectedIds]    = useState(new Set())
  const [batchMode,      setBatchMode]      = useState(false)
  const [showMap,        setShowMap]        = useState(false)
  const [focusTx,        setFocusTx]        = useState(null)

  // ── Status persistido em localStorage ──
  const [statusMap, setStatusMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ord_statusMap') || '{}') } catch { return {} }
  })

  const getStatus = useCallback((t) => {
    if (t.status && t.status !== 'pendente') return t.status
    if (statusMap[t.id]) return statusMap[t.id]
    const loc = unpackLocation(t.itemName)
    return loc?.rastreio ? 'em_envio' : 'pendente'
  }, [statusMap])

  const updateStatus = useCallback(async (id, newStatus) => {
    const next = { ...statusMap, [id]: newStatus }
    setStatusMap(next)
    localStorage.setItem('ord_statusMap', JSON.stringify(next))
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t))
    await supabase.from('transactions').update({ status: newStatus }).eq('id', id).maybeSingle().catch(() => {})
  }, [statusMap, setTransactions])

  const deleteTransaction = useCallback(async (id) => {
    if (!window.confirm('Excluir este pedido permanentemente?')) return
    await supabase.from('transactions').delete().eq('id', id)
    setTransactions(prev => prev.filter(t => t.id !== id))
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
    addToast('Pedido excluído.', 'info')
  }, [setTransactions, addToast])

  // ── Sales data ──
  const now   = useMemo(() => new Date(), [])
  const sales = useMemo(() => transactions.filter(t => t.type === 'saída'), [transactions])

  // ── KPIs ──
  const todayStr      = now.toLocaleDateString('pt-BR')
  const todayCount    = useMemo(() => sales.filter(t => t.date?.split(' ')[0] === todayStr).length, [sales, todayStr])
  const emEnvioCount  = useMemo(() => sales.filter(t => getStatus(t) === 'em_envio').length, [sales, getStatus])
  const finalizCount  = useMemo(() => sales.filter(t => getStatus(t) === 'finalizado').length, [sales, getStatus])
  const problemaCount = useMemo(() => sales.filter(t => getStatus(t) === 'problema').length, [sales, getStatus])

  // ── Filtered sales ──
  const filteredSales = useMemo(() => {
    let list = [...sales]
    if (filterPeriod !== 'all') {
      const days = filterPeriod === 'today' ? 1 : filterPeriod === 'week' ? 7 : 30
      list = list.filter(t => (now - parseDate(t.date)) < days * 86_400_000)
    }
    if (filterStatus  !== 'all') list = list.filter(t => getStatus(t) === filterStatus)
    if (filterCity    !== 'all') list = list.filter(t => (unpackLocation(t.itemName)?.city || t.city) === filterCity)
    if (filterProduct !== 'all') list = list.filter(t => t.itemName?.split('||')[0]?.trim() === filterProduct)
    if (search.trim()) {
      const q = normalizeText(search)
      list = list.filter(t => {
        const loc = unpackLocation(t.itemName)
        return (
          normalizeText(t.personName  || '').includes(q) ||
          normalizeText(t.itemName    || '').includes(q) ||
          normalizeText(loc?.city     || t.city || '').includes(q) ||
          normalizeText(loc?.rastreio || '').includes(q) ||
          normalizeText(loc?.orderId  || '').includes(q)
        )
      })
    }
    return list.reverse()
  }, [sales, filterPeriod, filterStatus, filterCity, filterProduct, search, getStatus, now])

  const cities   = useMemo(() => [...new Set(sales.map(t => unpackLocation(t.itemName)?.city || t.city).filter(Boolean))].sort(), [sales])
  const products = useMemo(() => [...new Set(sales.map(t => t.itemName?.split('||')[0]?.trim()).filter(Boolean))].sort(), [sales])

  const hasFilters = search || filterStatus !== 'all' || filterCity !== 'all' || filterProduct !== 'all' || filterPeriod !== 'all'

  // ── Ações em lote ──
  const handleBatchStatus = useCallback(async (newStatus) => {
    const ids = [...selectedIds]
    for (const id of ids) await updateStatus(id, newStatus)
    addToast(`${ids.length} pedido${ids.length > 1 ? 's' : ''} atualizado${ids.length > 1 ? 's' : ''}.`, 'success')
    setSelectedIds(new Set())
  }, [selectedIds, updateStatus, addToast])

  const handleBatchDelete = useCallback(async () => {
    const ids = [...selectedIds]
    if (!window.confirm(`Excluir ${ids.length} pedido${ids.length > 1 ? 's' : ''}?`)) return
    for (const id of ids) await supabase.from('transactions').delete().eq('id', id)
    setTransactions(prev => prev.filter(t => !selectedIds.has(t.id)))
    setSelectedIds(new Set())
    addToast(`${ids.length} pedido${ids.length > 1 ? 's' : ''} excluído${ids.length > 1 ? 's' : ''}.`, 'info')
  }, [selectedIds, setTransactions, addToast])

  // ── Handlers do formulário (preservados intactos) ──
  const filteredProducts = useMemo(() => {
    const tokens = normalizeText(productSearch).split(/\s+/).filter(Boolean)
    return tokens.length
      ? inventory.filter(i => tokens.every(t => normalizeText(`${i.name} ${i.category || ''}`).includes(t)))
      : inventory
  }, [inventory, productSearch])

  const handleLabelData = useCallback(async (data) => {
    if (data.location || data.cep) {
      let loc = data.location || ''
      const cep = (data.cep || '').replace(/\D/g, '')
      if (cep && !loc.includes(cep)) {
        const fmt = cep.replace(/(\d{5})(\d{3})/, '$1-$2')
        loc += loc ? ` - CEP: ${fmt}` : fmt
      }
      setLocation(loc)
    }
    if (data.quantity)   setQuantity(Number(data.quantity))
    if (data.orderId)    setOrderRef(data.orderId)
    if (data.address)    setAddress(data.address)
    if (data.bairro)     setBairro(data.bairro)
    if (data.rastreio)   setRastreio(data.rastreio)
    if (data.modalidade) setModalidade(data.modalidade)
    if (data.nf && !orderRef) setOrderRef(`NF: ${data.nf}`)

    if (data.productName) {
      setProductSearch(data.productName)
      const tokens = normalizeText(data.productName).split(/\s+/).filter(t => t.length > 1)
      let best = null, bestScore = 0
      inventory.forEach(item => {
        const score = tokens.filter(t => normalizeText(item.name).includes(t)).length
        if (score > bestScore) { bestScore = score; best = item }
      })
      if (best && bestScore > 0) setSelectedItem(best.id)
    }

    if (data.customerName) {
      const name = data.customerName.trim()
      const existing = pessoas.find(p => p.name.toLowerCase() === name.toLowerCase())
      if (existing) {
        setSelectedPessoa(existing.name)
        addToast(`✅ Cliente identificado: ${existing.name}`, 'success')
      } else {
        setSelectedPessoa(name)
        addToast(`👤 Novo cliente detectado: ${name}`, 'info')
        const novo = { id: generateId(), name, document: '', role: 'cliente', contact: '' }
        if (setPessoas) setPessoas(prev => [...prev, novo])
        await supabase.from('pessoas').insert([novo])
      }
    }
  }, [inventory, pessoas, setPessoas, addToast, orderRef])

  // ── Drag & Drop de imagem para extração de dados ────────────────────────────
  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) {
      addToast('Arraste uma imagem de etiqueta ou pedido.', 'warning')
      return
    }
    setDragProcessing(true)
    addToast('🔍 Lendo imagem...', 'info')
    try {
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = ev => res(ev.target.result)
        reader.onerror = rej
        reader.readAsDataURL(file)
      })
      const { data: { text } } = await Tesseract.recognize(dataUrl, 'por')
      let result = await analyzeText(text, inventory, pessoas)
      if (!result || (!result.customerName && !result.location)) {
        addToast('Refinando com IA visual...', 'info')
        const b64 = dataUrl.split(',')[1]
        result = await analyzeDocument(`data:image/jpeg;base64,${b64}`, inventory, pessoas)
      }
      if (result && (result.customerName || result.location)) {
        await handleLabelData(result)
        addToast('✅ Dados extraídos da imagem!', 'success')
      } else {
        addToast('Não foi possível extrair dados. Tente outra imagem.', 'warning')
      }
    } catch (err) {
      addToast(`Erro ao processar imagem: ${err.message}`, 'error')
    } finally {
      setDragProcessing(false)
    }
  }, [inventory, pessoas, handleLabelData, addToast])

  const handleOrder = useCallback(async (e) => {
    e.preventDefault()
    if (!selectedItem || !selectedPessoa || quantity <= 0 || !location) {
      addToast('Preencha todos os campos obrigatórios.', 'warning'); return
    }
    setProcessing(true)
    try {
      const item = inventory.find(i => i.id === selectedItem)
      let pessoa = pessoas.find(p => p.name.toLowerCase() === selectedPessoa.toLowerCase())
      if (!item) { addToast('Produto não encontrado.', 'error'); return }
      if (Number(item.quantity) < Number(quantity)) { addToast('Estoque insuficiente!', 'error'); return }
      if (!pessoa) {
        pessoa = { id: generateId(), name: selectedPessoa.trim(), document: '', role: 'cliente', contact: '' }
        if (setPessoas) setPessoas(prev => [...prev, pessoa])
        await supabase.from('pessoas').insert([pessoa])
        addToast(`Novo cliente "${pessoa.name}" cadastrado!`, 'success')
      }
      const geo = await geocode(location)
      const city = geo?.city || location.split('-')[0].split(',')[0].trim()
      const packedName = packLocation(item.name, {
        city, lat: geo?.lat, lng: geo?.lng, orderId: orderRef, cep: '',
        address, bairro, rastreio, modalidade,
      })
      const newQty = Number(item.quantity) - Number(quantity)
      const tx = {
        id: generateId(), type: 'saída', itemId: item.id, itemName: packedName, city,
        quantity: Number(quantity), unitPrice: item.price,
        totalValue: item.price * Number(quantity),
        personName: pessoa.name, date: formatDate(), status: 'pendente',
      }
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('inventory').update({ quantity: newQty }).eq('id', item.id),
        supabase.from('transactions').insert([tx]),
      ])
      if (e1 || e2) throw new Error('Erro ao salvar no banco.')
      setInventory(prev => prev.map(i => i.id === item.id ? { ...i, quantity: newQty } : i))
      setTransactions(prev => [...prev, tx])
      addToast(`✅ Pedido de ${quantity}x "${item.name}" registrado!`, 'success')
      setProductSearch(''); setSelectedItem(''); setSelectedPessoa('')
      setQuantity(1); setLocation(''); setAddress(''); setBairro('')
      setOrderRef(''); setRastreio(''); setModalidade('')
      setPageTab('central')
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error')
    } finally {
      setProcessing(false)
    }
  }, [selectedItem, selectedPessoa, quantity, location, address, bairro, orderRef, rastreio, modalidade, inventory, pessoas, setPessoas, setInventory, setTransactions, addToast])

  const sharedProps = { inventory, setInventory, transactions, setTransactions, pessoas, setPessoas, addToast }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="page" style={{ maxWidth: 1300, margin: '0 auto', background: '#f8fafc', minHeight: '100vh' }}>

      {/* ══ HEADER ══════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '1.3rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.3px' }}>
            🛒 Central de Pedidos
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.78rem', margin: '0.15rem 0 0' }}>
            {sales.length} pedido{sales.length !== 1 ? 's' : ''} no total · {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {[['central', '📊 Central'], ['form', '➕ Novo Pedido'], ['batch', '📷 Scanner']].map(([v, l]) => (
            <button
              key={v} onClick={() => setPageTab(v)}
              style={{
                padding: '0.42rem 0.9rem', borderRadius: 9, border: 'none',
                background: pageTab === v ? '#2563eb' : '#fff',
                color: pageTab === v ? '#fff' : '#374151',
                fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                boxShadow: pageTab === v ? '0 2px 8px rgba(37,99,235,0.3)' : '0 1px 3px rgba(0,0,0,0.08)',
                transition: 'all 0.15s',
              }}
            >{l}</button>
          ))}
        </div>
      </div>

      {/* ══ TAB: SCANNER ════════════════════════════════════════════════════════ */}
      {pageTab === 'batch' && <BatchScanner {...sharedProps} />}

      {/* ══ TAB: FORMULÁRIO ══════════════════════════════════════════════════════ */}
      {pageTab === 'form' && (
        <div className="card" style={{ maxWidth: 680 }}>
          <button
            type="button" className="btn btn-secondary"
            style={{ width: '100%', marginBottom: showLabel ? '0.75rem' : 0, justifyContent: 'center', gap: '0.5rem' }}
            onClick={() => setShowLabel(v => !v)}
          >
            {showLabel ? '▲' : '▼'} 🤖 Ler Etiqueta / Foto de Pedido
          </button>
          {showLabel && (
            <>
              <LabelAssistant inventory={inventory} pessoas={pessoas} addToast={addToast} onDataExtracted={handleLabelData} />
              <hr className="divider" />
            </>
          )}

          {/* ── Zona de Drag & Drop ── */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragOver ? '#2563eb' : '#cbd5e1'}`,
              borderRadius: 10,
              padding: '0.85rem 1rem',
              marginBottom: '0.5rem',
              background: dragOver ? '#eff6ff' : dragProcessing ? '#f8fafc' : 'transparent',
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              transition: 'all 0.18s',
              cursor: 'default',
            }}
          >
            <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>
              {dragProcessing ? '⏳' : dragOver ? '📂' : '🖼️'}
            </span>
            <div>
              <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: dragOver ? '#2563eb' : '#475569' }}>
                {dragProcessing ? 'Extraindo dados...' : dragOver ? 'Solte para extrair dados' : 'Arraste uma foto da etiqueta aqui'}
              </p>
              <p style={{ margin: 0, fontSize: '0.73rem', color: '#94a3b8' }}>
                Os campos do formulário serão preenchidos automaticamente
              </p>
            </div>
          </div>

          <form onSubmit={handleOrder} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label>Produto</label>
              <input type="text" placeholder="🔍 Buscar produto..." value={productSearch} onChange={e => setProductSearch(e.target.value)} style={{ marginBottom: '0.4rem' }} />
              <select value={selectedItem} onChange={e => setSelectedItem(e.target.value)} required style={{ borderColor: productSearch ? 'var(--border-focus)' : undefined }}>
                <option value="">{filteredProducts.length ? 'Selecione o produto...' : 'Nenhum produto encontrado'}</option>
                {filteredProducts.map(i => (
                  <option key={i.id} value={i.id} disabled={i.quantity <= 0}>
                    {i.name} ({i.quantity} un.) — R$ {Number(i.price).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Cliente</label>
              <input type="text" list="pessoas-list" placeholder="Nome do cliente..." value={selectedPessoa} onChange={e => setSelectedPessoa(e.target.value)} required />
              <datalist id="pessoas-list">{pessoas.map(p => <option key={p.id} value={p.name} />)}</datalist>
            </div>

            <div className="form-row">
              <div className="form-group" style={{ maxWidth: 120 }}>
                <label>Quantidade</label>
                <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} min="1" required />
              </div>
              <div className="form-group">
                <label>Referência / Pedido</label>
                <input type="text" placeholder="Ex: #12345 ou NF: 999" value={orderRef} onChange={e => setOrderRef(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Destino (Cidade ou CEP) *</label>
                <input type="text" placeholder="Ex: São Paulo ou 01310-000" value={location} onChange={e => setLocation(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Endereço Completo</label>
                <input type="text" placeholder="Rua, Número" value={address} onChange={e => setAddress(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Bairro</label>
                <input type="text" value={bairro} onChange={e => setBairro(e.target.value)} placeholder="Ex: Centro" />
              </div>
              <div className="form-group">
                <label>Rastreio</label>
                <input type="text" value={rastreio} onChange={e => setRastreio(e.target.value)} placeholder="BR0000000000000" />
              </div>
              <div className="form-group">
                <label>Modalidade</label>
                <select value={modalidade} onChange={e => setModalidade(e.target.value)}>
                  <option value="">Selecione...</option>
                  {['COLETA','PAC','SEDEX','SEDEX 10','JADLOG','CORREIOS','TRANSPORTADORA','RETIRADA'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={processing}>
              {processing ? '⏳ Processando...' : '🔥 Finalizar Pedido e Marcar no Mapa'}
            </button>
          </form>
        </div>
      )}

      {/* ══ TAB: CENTRAL ════════════════════════════════════════════════════════ */}
      {pageTab === 'central' && (
        <>
          {/* ── KPI Summary Cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: '0.85rem', marginBottom: '1.2rem' }}>
            <SummaryCard
              icon="📅" label="Hoje" value={todayCount}
              color="#2563eb" bg="#eff6ff" border="#bfdbfe"
              active={filterPeriod === 'today'}
              onClick={() => setFilterPeriod(p => p === 'today' ? 'all' : 'today')}
              sub={`de ${sales.length} total`}
            />
            <SummaryCard
              icon="🚚" label="Em Envio" value={emEnvioCount}
              color="#d97706" bg="#fef3c7" border="#fde68a"
              active={filterStatus === 'em_envio'}
              onClick={() => setFilterStatus(s => s === 'em_envio' ? 'all' : 'em_envio')}
              sub="clique para filtrar"
            />
            <SummaryCard
              icon="✅" label="Finalizados" value={finalizCount}
              color="#16a34a" bg="#dcfce7" border="#bbf7d0"
              active={filterStatus === 'finalizado'}
              onClick={() => setFilterStatus(s => s === 'finalizado' ? 'all' : 'finalizado')}
              sub="clique para filtrar"
            />
            <SummaryCard
              icon="⚠️" label="Problemas" value={problemaCount}
              color="#dc2626" bg="#fee2e2" border="#fecaca"
              active={filterStatus === 'problema'}
              onClick={() => setFilterStatus(s => s === 'problema' ? 'all' : 'problema')}
              sub={problemaCount > 0 ? 'requer atenção!' : 'tudo certo'}
            />
          </div>

          {/* ── Search + Filters ── */}
          <div style={{
            background: '#fff', borderRadius: 14, padding: '0.8rem 1rem',
            marginBottom: '0.85rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            display: 'flex', gap: '0.55rem', flexWrap: 'wrap', alignItems: 'center',
          }}>
            {/* Busca global */}
            <div style={{ position: 'relative', flex: '1 1 230px', minWidth: 190 }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none', fontSize: '0.85rem' }}>🔍</span>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar cliente, produto, cidade, rastreio..."
                style={{
                  width: '100%', background: '#f8fafc', border: '1.5px solid #e2e8f0',
                  borderRadius: 8, padding: '0.42rem 0.7rem 0.42rem 32px', fontSize: '0.79rem',
                  outline: 'none', boxSizing: 'border-box',
                  borderColor: search ? '#2563eb' : '#e2e8f0',
                }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '0.85rem', padding: 0 }}>✕</button>
              )}
            </div>

            {/* Período pills */}
            <div style={{ display: 'flex', gap: '0.18rem', background: '#f1f5f9', borderRadius: 8, padding: '0.18rem', flexShrink: 0 }}>
              {[['today','Hoje'],['week','7d'],['month','30d'],['all','Tudo']].map(([v, l]) => (
                <button key={v} onClick={() => setFilterPeriod(v)} style={{
                  padding: '0.25rem 0.55rem', border: 'none', borderRadius: 6,
                  fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                  background: filterPeriod === v ? '#2563eb' : 'transparent',
                  color: filterPeriod === v ? '#fff' : '#64748b', transition: 'all 0.12s',
                }}>{l}</button>
              ))}
            </div>

            <div style={{ width: 1, height: 24, background: '#e2e8f0', flexShrink: 0 }} />

            {/* Status */}
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selStyle(filterStatus !== 'all')}>
              <option value="all">📊 Status</option>
              {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>

            {/* Cidade */}
            <select value={filterCity} onChange={e => setFilterCity(e.target.value)} style={selStyle(filterCity !== 'all')}>
              <option value="all">📍 Cidade</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* Produto */}
            <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)} style={selStyle(filterProduct !== 'all')}>
              <option value="all">📦 Produto</option>
              {products.map(p => <option key={p} value={p}>{p}</option>)}
            </select>

            {/* Lote + Limpar */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
              <button
                onClick={() => { setBatchMode(v => !v); setSelectedIds(new Set()) }}
                style={{
                  padding: '0.38rem 0.75rem', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                  border: `1.5px solid ${batchMode ? '#7c3aed' : '#e2e8f0'}`,
                  background: batchMode ? '#ede9fe' : '#f8fafc',
                  color: batchMode ? '#7c3aed' : '#64748b',
                }}
              >
                {batchMode ? '✗ Sair Lote' : '☑️ Modo Lote'}
              </button>
              {hasFilters && (
                <button
                  onClick={() => { setSearch(''); setFilterStatus('all'); setFilterCity('all'); setFilterProduct('all'); setFilterPeriod('all') }}
                  style={{ padding: '0.38rem 0.65rem', borderRadius: 8, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}
                >✕ Limpar</button>
              )}
            </div>
          </div>

          {/* ── Barra de ações em lote ── */}
          {batchMode && selectedIds.size > 0 && (
            <div style={{
              background: 'linear-gradient(135deg,#ede9fe,#ddd6fe)', border: '1px solid #c4b5fd',
              borderRadius: 12, padding: '0.65rem 1rem', marginBottom: '0.75rem',
              display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
            }}>
              <span style={{ fontWeight: 800, color: '#7c3aed', fontSize: '0.82rem' }}>
                ☑️ {selectedIds.size} selecionado{selectedIds.size > 1 ? 's' : ''}
              </span>
              <div style={{ width: 1, height: 20, background: '#c4b5fd', flexShrink: 0 }} />
              <button onClick={() => handleBatchStatus('em_envio')}  style={batchBtnStyle('#fef3c7','#d97706','#fde68a')}>🚚 Em Envio</button>
              <button onClick={() => handleBatchStatus('finalizado')} style={batchBtnStyle('#dcfce7','#16a34a','#bbf7d0')}>✅ Finalizar</button>
              <button onClick={() => handleBatchStatus('problema')}   style={batchBtnStyle('#fee2e2','#dc2626','#fecaca')}>⚠️ Problema</button>
              <button onClick={() => handleBatchStatus('pendente')}   style={batchBtnStyle('#eff6ff','#2563eb','#bfdbfe')}>🕐 Pendente</button>
              <button onClick={handleBatchDelete} style={{ ...batchBtnStyle('#fee2e2','#dc2626','#fecaca'), marginLeft: 'auto' }}>🗑️ Excluir</button>
            </div>
          )}

          {/* ── Tabela de Pedidos ── */}
          <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden', marginBottom: '0.85rem' }}>

            {/* Cabeçalho da tabela */}
            <div style={{
              padding: '0.8rem 1.2rem', borderBottom: '1px solid #f1f5f9',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Pedidos
                </span>
                <span style={{
                  background: hasFilters ? '#eff6ff' : '#f1f5f9',
                  color: hasFilters ? '#2563eb' : '#64748b',
                  borderRadius: 99, padding: '1px 9px', fontSize: '0.72rem', fontWeight: 700,
                }}>
                  {filteredSales.length}{hasFilters ? ` / ${sales.length}` : ''}
                </span>
              </div>
              <button
                onClick={() => setShowMap(v => !v)}
                style={{
                  padding: '0.32rem 0.8rem', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                  border: `1.5px solid ${showMap ? '#bfdbfe' : '#e2e8f0'}`,
                  background: showMap ? '#eff6ff' : '#f8fafc',
                  color: showMap ? '#2563eb' : '#64748b',
                }}
              >
                🗺️ {showMap ? 'Ocultar Mapa' : 'Ver Mapa'}
              </button>
            </div>

            {filteredSales.length === 0 ? (
              <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: '2.8rem', marginBottom: '0.6rem' }}>📭</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#64748b' }}>
                  {sales.length === 0 ? 'Nenhum pedido registrado ainda' : 'Nenhum pedido encontrado com esses filtros'}
                </div>
                {hasFilters && (
                  <button
                    onClick={() => { setSearch(''); setFilterStatus('all'); setFilterCity('all'); setFilterProduct('all'); setFilterPeriod('all') }}
                    style={{ marginTop: '0.75rem', padding: '0.4rem 1rem', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontSize: '0.78rem', color: '#2563eb', fontWeight: 600 }}
                  >
                    Limpar filtros
                  </button>
                )}
                {sales.length === 0 && (
                  <button
                    onClick={() => setPageTab('form')}
                    style={{ marginTop: '0.75rem', padding: '0.5rem 1.25rem', borderRadius: 8, border: 'none', background: '#2563eb', cursor: 'pointer', fontSize: '0.8rem', color: '#fff', fontWeight: 700 }}
                  >
                    ➕ Registrar Primeiro Pedido
                  </button>
                )}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      {batchMode && (
                        <th style={{ width: 38, padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            onChange={e => setSelectedIds(e.target.checked ? new Set(filteredSales.map(t => t.id)) : new Set())}
                            checked={selectedIds.size > 0 && selectedIds.size === filteredSales.length}
                            style={{ cursor: 'pointer', accentColor: '#7c3aed' }}
                          />
                        </th>
                      )}
                      {['Data','Cliente','Produto','Cidade','Qtd','Total','Status','Rastreio','Ações'].map(h => (
                        <th key={h} style={{
                          padding: '0.65rem 0.75rem', textAlign: 'left',
                          fontSize: '0.67rem', fontWeight: 800, color: '#94a3b8',
                          textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSales.map(t => (
                      <OrderRow
                        key={t.id}
                        tx={t}
                        status={getStatus(t)}
                        expanded={expandedId === t.id}
                        onExpand={id => setExpandedId(v => v === id ? null : id)}
                        onStatusChange={s => updateStatus(t.id, s)}
                        onViewMap={tx => { setFocusTx(tx); setShowMap(true) }}
                        onDelete={deleteTransaction}
                        selected={selectedIds.has(t.id)}
                        onSelect={(id, checked) => setSelectedIds(prev => {
                          const next = new Set(prev)
                          checked ? next.add(id) : next.delete(id)
                          return next
                        })}
                        batchMode={batchMode}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Mapa retrátil */}
            {showMap && (
              <div style={{ borderTop: '1px solid #f1f5f9' }}>
                <div style={{ padding: '0.6rem 1.2rem', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b' }}>
                    🗺️ Mapa de Pedidos {focusTx ? `— focado em ${focusTx.personName}` : `— ${sales.filter(t => unpackLocation(t.itemName)?.lat).length} pontos`}
                  </span>
                  {focusTx && (
                    <button onClick={() => setFocusTx(null)} style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', color: '#64748b' }}>
                      ✕ Resetar foco
                    </button>
                  )}
                </div>
                <OrdersMap transactions={transactions} focusTx={focusTx} />
              </div>
            )}
          </div>

        </>
      )}
    </div>
  )
}

// ─── Estilos utilitários ──────────────────────────────────────────────────────
function selStyle(active) {
  return {
    fontSize: '0.78rem', padding: '0.38rem 0.65rem', borderRadius: 8, cursor: 'pointer',
    border: `1.5px solid ${active ? '#2563eb' : '#e2e8f0'}`,
    background: active ? '#eff6ff' : '#f8fafc',
    color: active ? '#2563eb' : '#374151',
    fontWeight: active ? 700 : 400, outline: 'none',
  }
}

function batchBtnStyle(bg, color, border) {
  return {
    padding: '4px 11px', borderRadius: 8,
    border: `1px solid ${border}`, background: bg, color,
    fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer',
  }
}
