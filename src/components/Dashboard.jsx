import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { unpackLocation, buildColorMap, jitter } from '../utils/location'
import { formatCurrency } from '../utils/formatting'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return new Date(0)
  const [d, m, y] = (str.split(' ')[0] || '').split('/')
  return new Date(`${y}-${m}-${d}`)
}

function loadScript(src, id) {
  if (document.getElementById(id)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.id = id
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}
function loadCSS(href, id) {
  if (document.getElementById(id)) return
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.id = id
  document.head.appendChild(l)
}

// ─── KPI Card com tendência ────────────────────────────────────────────────────
function KpiCard({ icon, label, value, trend, trendLabel, sub, color = '#2563eb', onClick, active }) {
  const trendUp   = trend > 0
  const trendDown = trend < 0
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff', borderRadius: 16, padding: '1.2rem 1.35rem',
        boxShadow: active
          ? `0 0 0 2px ${color}, 0 4px 16px rgba(0,0,0,0.08)`
          : '0 1px 3px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.04)',
        borderTop: `3px solid ${color}`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.18s, transform 0.18s',
        display: 'flex', flexDirection: 'column', gap: '0.3rem',
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.transform = 'translateY(-2px)')}
      onMouseLeave={e => onClick && (e.currentTarget.style.transform = '')}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '1.35rem', background: `${color}15`, borderRadius: 10,
          width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</span>
        {trend !== undefined && trend !== null && (
          <span style={{
            fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 99,
            background: trendUp ? '#dcfce7' : trendDown ? '#fee2e2' : '#f1f5f9',
            color: trendUp ? '#16a34a' : trendDown ? '#dc2626' : '#64748b',
          }}>
            {trendUp ? '↑' : trendDown ? '↓' : '—'} {Math.abs(trend).toFixed(0)}%
          </span>
        )}
        {onClick && trend === undefined && (
          <span style={{ fontSize: '0.65rem', color, background: `${color}15`, padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>
            {active ? '▲' : '▼'}
          </span>
        )}
      </div>
      <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1, marginTop: '0.2rem' }}>
        {value}
      </span>
      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </span>
      {trendLabel && (
        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{trendLabel}</span>
      )}
      {sub && <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{sub}</span>}
    </div>
  )
}

// ─── Section Header ───────────────────────────────────────────────────────────
function Section({ title, right, children, style = {} }) {
  return (
    <div style={{ background: '#fff', borderRadius: 18, padding: '1.4rem 1.6rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.03)', ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.1rem' }}>
          {title && <h2 style={{ margin: 0, fontSize: '0.73rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

// ─── Tooltip customizado do gráfico ──────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '0.6rem 0.9rem', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
      <div style={{ color: '#94a3b8', fontSize: '0.7rem', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ color: '#fff', fontWeight: 700, fontSize: '0.88rem' }}>{formatCurrency(payload[0].value)}</div>
    </div>
  )
}

// ─── Componente principal ──────────────────────────────────────────────────────
export function Dashboard({ inventory, transactions, pessoas = [], prospectionLeads = [] }) {
  const [period,        setPeriod]        = useState('month')
  const [filterProduct, setFilterProduct] = useState('All')
  const [filterRegion,  setFilterRegion]  = useState('All')
  const [filterGender,  setFilterGender]  = useState('All')
  const [chartItem,     setChartItem]     = useState('All')
  const [chartCity,     setChartCity]     = useState('All')
  const [showLowStock,  setShowLowStock]  = useState(false)
  const [mapReady,      setMapReady]      = useState(false)

  const mapRef       = useRef(null)
  const mapInstance  = useRef(null)
  const clusterRef   = useRef(null)
  const heatRef      = useRef(null)

  const now = useMemo(() => new Date(), [])

  // ── Função de filtro por período ───────────────────────────────────────────
  const inPeriod = useMemo(() => (list, shift = 0) => {
    if (period === 'all') return shift === 0 ? list : []
    const span = period === 'today' ? 1 : period === 'week' ? 7 : 30
    return list.filter(t => {
      const ms = now - parseDate(t.date)
      const dayMs = 86400000
      return ms >= shift * span * dayMs && ms < (shift + 1) * span * dayMs
    })
  }, [period, now])

  // ── Dados filtrados ────────────────────────────────────────────────────────
  const genderMap = useMemo(() => {
    const m = {}; pessoas.forEach(p => { if (p.gender) m[p.name] = p.gender }); return m
  }, [pessoas])

  const baseFiltered = useMemo(() => {
    let list = transactions
    if (filterProduct !== 'All') list = list.filter(t => t.itemName.split('||')[0].trim() === filterProduct)
    if (filterRegion  !== 'All') list = list.filter(t => { const l = unpackLocation(t.itemName); return (l?.city || t.city) === filterRegion })
    if (filterGender  !== 'All') list = list.filter(t => (genderMap[t.personName] || '') === filterGender)
    return list
  }, [transactions, filterProduct, filterRegion, filterGender, genderMap])

  const exits     = useMemo(() => inPeriod(baseFiltered.filter(t => t.type === 'saída'),  0), [baseFiltered, inPeriod])
  const exitsPrev = useMemo(() => inPeriod(baseFiltered.filter(t => t.type === 'saída'),  1), [baseFiltered, inPeriod])
  const allExits  = useMemo(() => baseFiltered.filter(t => t.type === 'saída'), [baseFiltered])

  // ── KPI: receita, pedidos, ticket médio ───────────────────────────────────
  const revenue     = useMemo(() => exits.reduce((s, t) => s + Number(t.totalValue || 0), 0), [exits])
  const revenuePrev = useMemo(() => exitsPrev.reduce((s, t) => s + Number(t.totalValue || 0), 0), [exitsPrev])
  const revTrend    = revenuePrev > 0 ? ((revenue - revenuePrev) / revenuePrev) * 100 : null

  const orders      = exits.length
  const ordersPrev  = exitsPrev.length
  const ordTrend    = ordersPrev > 0 ? ((orders - ordersPrev) / ordersPrev) * 100 : null

  const ticket      = orders > 0 ? revenue / orders : 0
  const ticketPrev  = ordersPrev > 0 ? revenuePrev / ordersPrev : 0
  const tickTrend   = ticketPrev > 0 ? ((ticket - ticketPrev) / ticketPrev) * 100 : null

  const totalStock   = useMemo(() => inventory.reduce((s, i) => s + Number(i.quantity || 0), 0), [inventory])
  const stockValue   = useMemo(() => inventory.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.price || 0), 0), [inventory])
  const lowStockItems = useMemo(() => inventory.filter(i => Number(i.quantity) > 0 && Number(i.quantity) < 10).sort((a, b) => a.quantity - b.quantity), [inventory])
  const noStockItems  = useMemo(() => inventory.filter(i => Number(i.quantity) === 0), [inventory])

  // ── Gráfico de receita ─────────────────────────────────────────────────────
  const chartExits = useMemo(() => {
    let list = allExits
    if (chartItem !== 'All') list = list.filter(t => t.itemName.split('||')[0].trim() === chartItem)
    if (chartCity !== 'All') list = list.filter(t => { const l = unpackLocation(t.itemName); return (l?.city || t.city) === chartCity })
    return list
  }, [allExits, chartItem, chartCity])

  const chartData = useMemo(() => {
    const m = {}
    chartExits.forEach(t => { const d = t.date.split(' ')[0]; m[d] = (m[d] || 0) + Number(t.totalValue || 0) })
    return Object.entries(m)
      .map(([date, receita]) => ({ date, receita }))
      .sort((a, b) => parseDate(a.date) - parseDate(b.date))
      .slice(-30)
  }, [chartExits])

  const avgRevenue = chartData.length ? chartData.reduce((s, d) => s + d.receita, 0) / chartData.length : 0

  // ── Ranking de produtos ────────────────────────────────────────────────────
  const productRanking = useMemo(() => {
    const m = {}
    allExits.forEach(t => {
      const loc  = unpackLocation(t.itemName)
      const name = loc?.cleanName || t.itemName.split('||')[0].trim()
      if (!m[name]) m[name] = { qty: 0, revenue: 0 }
      m[name].qty     += Number(t.quantity  || 1)
      m[name].revenue += Number(t.totalValue || 0)
    })
    const arr = Object.entries(m).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue)
    const total = arr.reduce((s, p) => s + p.revenue, 0) || 1
    return arr.map(p => ({ ...p, pct: Math.round((p.revenue / total) * 100) }))
  }, [allExits])

  // ── Rankings regionais ─────────────────────────────────────────────────────
  const regionData = useMemo(() => {
    const m = {}
    allExits.forEach(t => {
      const loc = unpackLocation(t.itemName)
      const r   = loc?.city || t.city || 'Desconhecido'
      if (!m[r]) m[r] = { vendas: 0, receita: 0 }
      m[r].vendas++; m[r].receita += Number(t.totalValue || 0)
    })
    return Object.entries(m).map(([region, v]) => ({ region, ...v })).sort((a, b) => b.receita - a.receita)
  }, [allExits])

  // ── Cidade → Produtos ──────────────────────────────────────────────────────
  const cityByProduct = useMemo(() => {
    const m = {}
    allExits.forEach(t => {
      const loc  = unpackLocation(t.itemName)
      const prod = loc?.cleanName || t.itemName.split('||')[0].trim()
      const city = loc?.city || t.city || null
      if (!city) return
      if (!m[city]) m[city] = { cidade: city, totalQtd: 0, totalReceita: 0, produtos: {} }
      if (!m[city].produtos[prod]) m[city].produtos[prod] = { qtd: 0, receita: 0 }
      m[city].produtos[prod].qtd     += Number(t.quantity  || 1)
      m[city].produtos[prod].receita += Number(t.totalValue || 0)
      m[city].totalQtd               += Number(t.quantity  || 1)
      m[city].totalReceita           += Number(t.totalValue || 0)
    })
    return Object.values(m)
      .sort((a, b) => b.totalReceita - a.totalReceita)
      .map(c => ({
        ...c,
        produtos: Object.entries(c.produtos).map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.qtd - a.qtd),
      }))
  }, [allExits])

  const products = useMemo(() => [...new Set(transactions.map(t => t.itemName.split('||')[0].trim()))], [transactions])
  const regions  = useMemo(() => [...new Set(transactions.map(t => { const l = unpackLocation(t.itemName); return l?.city || t.city }).filter(Boolean))], [transactions])
  const colorMap = useMemo(() => {
    const names = [...new Set(allExits.map(t => { const l = unpackLocation(t.itemName); return l?.cleanName || t.itemName.split('||')[0].trim() }))]
    return buildColorMap(names, inventory)
  }, [allExits, inventory])

  const hasFilters = filterProduct !== 'All' || filterRegion !== 'All' || filterGender !== 'All'

  // ── Mapa — carrega plugins CDN ─────────────────────────────────────────────
  useEffect(() => {
    loadCSS('https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css', 'mc-css-db')
    loadCSS('https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css', 'mc-dcss-db')
    const go = async () => {
      while (!window.L) await new Promise(r => setTimeout(r, 100))
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js', 'mc-js-db').catch(() => {})
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js', 'lheat-js-db').catch(() => {})
      setMapReady(true)
    }
    go()
  }, [])

  useEffect(() => {
    if (!mapReady) return
    const init = () => {
      if (!mapRef.current || mapInstance.current) return
      if (!window.L) { setTimeout(init, 200); return }
      mapInstance.current = window.L.map(mapRef.current, { zoomControl: true }).setView([-15.78, -47.93], 4)
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 18,
      }).addTo(mapInstance.current)
      if (window.L.markerClusterGroup) {
        clusterRef.current = window.L.markerClusterGroup({
          maxClusterRadius: 45, showCoverageOnHover: false,
          iconCreateFunction: c => {
            const n = c.getChildCount(); const s = n < 10 ? 32 : 40
            return window.L.divIcon({
              html: `<div style="width:${s}px;height:${s}px;border-radius:50%;background:rgba(37,99,235,0.85);border:2.5px solid #fff;box-shadow:0 2px 8px rgba(37,99,235,0.4);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${n<10?13:11}px;font-family:inherit">${n}</div>`,
              className: '', iconSize: [s, s], iconAnchor: [s/2, s/2],
            })
          },
        })
        mapInstance.current.addLayer(clusterRef.current)
      }
      setTimeout(() => mapInstance.current?.invalidateSize(), 150)
    }
    init()
    return () => {
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null }
      clusterRef.current = null
    }
  }, [mapReady])

  useEffect(() => {
    if (!mapInstance.current || !window.L || !mapReady) return
    clusterRef.current?.clearLayers()
    if (heatRef.current) { mapInstance.current.removeLayer(heatRef.current); heatRef.current = null }

    const blueIcon = window.L.divIcon({
      html: `<div style="width:12px;height:12px;border-radius:50%;background:#3b82f6;border:2px solid #fff;box-shadow:0 1px 6px rgba(59,130,246,0.5)"></div>`,
      className: '', iconSize: [12, 12], iconAnchor: [6, 6], popupAnchor: [0, -8],
    })

    const heatPoints = []
    allExits.forEach(t => {
      const loc = unpackLocation(t.itemName)
      if (!loc?.lat || !loc?.lng || isNaN(loc.lat)) return
      const lat = jitter(loc.lat); const lng = jitter(loc.lng)
      heatPoints.push([lat, lng, 0.8])
      const popup = `<div style="font-family:inherit;min-width:170px;font-size:0.8rem">
        <b style="font-size:0.88rem">${loc.cleanName || t.itemName.split('||')[0]}</b><br>
        <span style="color:#64748b">👤 ${t.personName || '—'} · 📍 ${loc.city || '—'}</span><br>
        <span style="color:#059669;font-weight:700">${formatCurrency(t.totalValue)}</span>
        <span style="color:#94a3b8;margin-left:6px;font-size:0.72rem">${(t.date||'').split(' ')[0]}</span>
      </div>`
      const m = window.L.marker([lat, lng], { icon: blueIcon }).bindPopup(popup)
      clusterRef.current ? clusterRef.current.addLayer(m) : m.addTo(mapInstance.current)
    })

    prospectionLeads.filter(l => l._lat && l._lon).forEach(lead => {
      const nearSale = allExits.some(t => {
        const loc = unpackLocation(t.itemName)
        if (!loc?.lat || !loc?.lng) return false
        const dlat = (loc.lat - lead._lat) * 111
        const dlng = (loc.lng - lead._lon) * 111 * Math.cos(lead._lat * Math.PI / 180)
        return Math.sqrt(dlat*dlat + dlng*dlng) < 50
      })
      const col  = nearSale ? '#f59e0b' : '#8b5cf6'
      const icon = window.L.divIcon({
        className: '',
        html: `<div style="background:${col};border:2px solid #fff;border-radius:50%;width:10px;height:10px;box-shadow:0 0 0 3px ${col}40"></div>`,
        iconSize: [10,10], iconAnchor: [5,5],
      })
      window.L.marker([lead._lat, lead._lon], { icon })
        .addTo(mapInstance.current)
        .bindPopup(`<b style="color:${col}">${nearSale?'🏢 Possível empresa':'🔍 Lead'}</b><br>${lead.nome}<br><span style="color:#64748b;font-size:0.75rem">📍 ${lead.cidade||''}</span>`)
    })

    if (window.L.heatLayer && heatPoints.length > 0) {
      heatRef.current = window.L.heatLayer(heatPoints, {
        radius: 25, blur: 18, maxZoom: 11,
        gradient: { 0.2: '#93c5fd', 0.6: '#3b82f6', 1: '#1d4ed8' },
      }).addTo(mapInstance.current)
    }

    try {
      if (clusterRef.current?.getLayers().length) mapInstance.current.fitBounds(clusterRef.current.getBounds().pad(0.2))
    } catch {}
    setTimeout(() => mapInstance.current?.invalidateSize(), 200)
  }, [allExits, prospectionLeads, mapReady])

  // ── Render ─────────────────────────────────────────────────────────────────
  const periodLabel = { all: 'Todo período', today: 'Hoje', week: 'Esta semana', month: 'Este mês' }[period]
  const totalRevAll = allExits.reduce((s, t) => s + Number(t.totalValue || 0), 0)

  return (
    <div className="page" style={{ maxWidth: 1280, margin: '0 auto', background: '#f8fafc', minHeight: '100vh' }}>

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.55rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.3px' }}>
            Dashboard
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.2rem', margin: 0 }}>
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        {/* Filtro de gênero */}
        <div style={{ display: 'flex', gap: '0.3rem', background: '#e2e8f0', borderRadius: 10, padding: '0.2rem' }}>
          {[['All','Todos'],['M','♂'],['F','♀'],['O','⚧']].map(([v, l]) => (
            <button key={v} onClick={() => setFilterGender(v)} style={{
              padding: '0.3rem 0.7rem', border: 'none', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
              background: filterGender === v ? '#fff' : 'transparent',
              color: filterGender === v ? '#2563eb' : '#64748b',
              boxShadow: filterGender === v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* ══ BARRA DE FILTROS ════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.5rem', padding: '0.75rem 1rem', background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>

        {/* Período */}
        <div style={{ display: 'flex', gap: '0.25rem', background: '#f1f5f9', borderRadius: 8, padding: '0.2rem', flexShrink: 0 }}>
          {[['today','Hoje'],['week','7 dias'],['month','30 dias'],['all','Tudo']].map(([v, l]) => (
            <button key={v} onClick={() => setPeriod(v)} style={{
              padding: '0.3rem 0.65rem', border: 'none', borderRadius: 6, fontSize: '0.74rem', fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
              background: period === v ? '#2563eb' : 'transparent',
              color: period === v ? '#fff' : '#64748b',
            }}>{l}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />

        {/* Produto + Cidade */}
        {[
          { value: filterProduct, set: setFilterProduct, opts: products, placeholder: 'Produto', icon: '📦' },
          { value: filterRegion,  set: setFilterRegion,  opts: regions,  placeholder: 'Cidade',  icon: '📍' },
        ].map(({ value, set, opts, placeholder, icon }) => (
          <select key={placeholder} value={value} onChange={e => set(e.target.value)} style={{
            fontSize: '0.78rem', padding: '0.35rem 0.75rem', borderRadius: 8, cursor: 'pointer', outline: 'none',
            border: value !== 'All' ? '1.5px solid #2563eb' : '1.5px solid #e2e8f0',
            background: value !== 'All' ? '#eff6ff' : '#f8fafc',
            color: value !== 'All' ? '#2563eb' : '#374151', fontWeight: value !== 'All' ? 700 : 400,
          }}>
            <option value="All">{icon} {placeholder}</option>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}

        {hasFilters && (
          <button onClick={() => { setFilterProduct('All'); setFilterRegion('All'); setFilterGender('All') }}
            style={{ fontSize: '0.72rem', padding: '0.35rem 0.65rem', borderRadius: 8, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', cursor: 'pointer', fontWeight: 600, marginLeft: 'auto' }}>
            ✕ Limpar
          </button>
        )}
      </div>

      {/* ══ KPIs ════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: '0.9rem', marginBottom: '1.25rem' }}>
        <KpiCard
          icon="💰" label="Receita" color="#2563eb"
          value={formatCurrency(revenue)}
          trend={revTrend}
          trendLabel={period !== 'all' ? `vs ${periodLabel.toLowerCase()} anterior` : undefined}
        />
        <KpiCard
          icon="🛒" label="Pedidos" color="#7c3aed"
          value={orders}
          trend={ordTrend}
          trendLabel={period !== 'all' ? 'vs período anterior' : undefined}
        />
        <KpiCard
          icon="🎯" label="Ticket Médio" color="#0891b2"
          value={ticket > 0 ? formatCurrency(ticket) : '—'}
          trend={tickTrend}
          trendLabel={period !== 'all' ? 'por pedido' : undefined}
        />
        <KpiCard
          icon="📦" label="Estoque Total" color="#059669"
          value={totalStock.toLocaleString('pt-BR')}
          sub={`Valor: ${formatCurrency(stockValue)}`}
        />
        <KpiCard
          icon="⚠️" label="Estoque Baixo" color="#d97706"
          value={lowStockItems.length}
          sub={noStockItems.length > 0 ? `🔴 ${noStockItems.length} zerado${noStockItems.length > 1 ? 's' : ''}` : '1–9 unidades'}
          onClick={() => setShowLowStock(v => !v)} active={showLowStock}
          trend={undefined}
        />
        <KpiCard
          icon="📈" label="Receita Total" color="#16a34a"
          value={formatCurrency(totalRevAll)}
          sub={`${allExits.length} pedidos no total`}
        />
      </div>

      {/* ══ PAINEL ESTOQUE BAIXO ════════════════════════════════════════════ */}
      {showLowStock && (
        <div style={{
          background: 'linear-gradient(135deg,#fffbeb,#fef3c7)', border: '1px solid #fde68a',
          borderRadius: 16, padding: '1.1rem 1.4rem', marginBottom: '1.25rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
            <span style={{ fontWeight: 700, color: '#92400e', fontSize: '0.85rem' }}>⚠️ Itens com menos de 10 unidades</span>
            <button onClick={() => setShowLowStock(false)} style={{ background: 'none', border: 'none', color: '#b45309', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {lowStockItems.map(i => (
              <div key={i.id} style={{
                background: '#fff', border: '1px solid #fde68a', borderRadius: 10,
                padding: '0.45rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.55rem',
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 7, background: '#fef3c7',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0
                }}>📦</span>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap' }}>{i.name}</div>
                  <div style={{ fontSize: '0.68rem', color: i.quantity <= 3 ? '#dc2626' : '#d97706', fontWeight: 700 }}>
                    {i.quantity} un.
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ GRÁFICO + RANKING DE PRODUTOS ═══════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '1rem', marginBottom: '1rem' }}>

        {/* Gráfico de Receita */}
        <Section title="Receita por Período" right={
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <select value={chartItem} onChange={e => setChartItem(e.target.value)} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#374151', cursor: 'pointer' }}>
              <option value="All">Todos produtos</option>
              {products.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={chartCity} onChange={e => setChartCity(e.target.value)} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#374151', cursor: 'pointer' }}>
              <option value="All">Todas cidades</option>
              {regions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {(chartItem !== 'All' || chartCity !== 'All') && (
              <button onClick={() => { setChartItem('All'); setChartCity('All') }} style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem', borderRadius: 6, border: '1px solid #fca5a5', background: 'none', color: '#dc2626', cursor: 'pointer' }}>✕</button>
            )}
          </div>
        }>
          {chartData.length === 0 ? (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.85rem', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '2rem' }}>📊</span>
              Sem vendas no período selecionado
            </div>
          ) : (
            <>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} interval="preserveStartEnd" />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => `R$${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} width={42} />
                    <Tooltip content={<ChartTooltip />} />
                    {avgRevenue > 0 && (
                      <ReferenceLine y={avgRevenue} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Média', position: 'insideRight', fontSize: 9, fill: '#94a3b8' }} />
                    )}
                    <Area dataKey="receita" stroke="#2563eb" strokeWidth={2} fill="url(#revGrad)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#2563eb' }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>
                <span>📊 <b style={{ color: '#0f172a' }}>{chartData.length}</b> dias</span>
                <span>📈 Média: <b style={{ color: '#2563eb' }}>{formatCurrency(avgRevenue)}</b>/dia</span>
                <span>🏆 Pico: <b style={{ color: '#16a34a' }}>{formatCurrency(Math.max(...chartData.map(d => d.receita)))}</b></span>
              </div>
            </>
          )}
        </Section>

        {/* Ranking de Produtos */}
        <Section title="Ranking de Produtos">
          {productRanking.length === 0 ? (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.82rem' }}>
              Sem vendas registradas
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {productRanking.slice(0, 6).map((p, i) => {
                const colors = ['#2563eb','#7c3aed','#0891b2','#059669','#d97706','#dc2626']
                const col = colors[i % colors.length]
                return (
                  <div key={p.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.2rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
                        <span style={{ width: 18, height: 18, borderRadius: 5, background: col, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.65rem', fontWeight: 800, flexShrink: 0 }}>{i+1}</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0, marginLeft: '0.5rem' }}>
                        <span style={{ fontSize: '0.68rem', color: col, fontWeight: 700 }}>{p.pct}%</span>
                        <span style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 700 }}>{formatCurrency(p.revenue)}</span>
                      </div>
                    </div>
                    <div style={{ background: '#f1f5f9', borderRadius: 99, height: 5, overflow: 'hidden' }}>
                      <div style={{ width: `${p.pct}%`, background: col, height: '100%', borderRadius: 99, transition: 'width 0.5s ease' }} />
                    </div>
                    <div style={{ fontSize: '0.67rem', color: '#94a3b8', marginTop: '0.15rem' }}>{p.qty} un. vendidas</div>
                  </div>
                )
              })}
            </div>
          )}
        </Section>
      </div>

      {/* ══ MAPA DE VENDAS (50% tela) ════════════════════════════════════════ */}
      <Section
        title="Distribuição Geográfica"
        style={{ padding: 0, overflow: 'hidden', marginBottom: '1rem' }}
        right={null}
      >
        {/* Header interno */}
        <div style={{ padding: '1rem 1.4rem 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '0.73rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Distribuição Geográfica
          </h2>
          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.68rem', color: '#64748b', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#3b82f6', border: '2px solid #fff', boxShadow: '0 1px 4px rgba(59,130,246,0.4)', display: 'inline-block' }} />
              Venda
            </span>
            {prospectionLeads.filter(l => l._lat).length > 0 && (<>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />Empresa
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6', display: 'inline-block' }} />Lead
              </span>
            </>)}
            <span style={{ color: '#94a3b8' }}>{allExits.filter(t => unpackLocation(t.itemName)?.lat).length} pontos</span>
          </div>
        </div>
        <div ref={mapRef} style={{ height: 'clamp(320px, 50vh, 520px)', width: '100%' }} />
      </Section>

      {/* ══ RANKING REGIONAL + CIDADES ══════════════════════════════════════ */}
      {(regionData.length > 0 || cityByProduct.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem', marginBottom: '1rem' }}>

          {/* Top Regiões */}
          <Section title="Top Cidades">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {regionData.slice(0, 8).map((r, i) => {
                const max = regionData[0]?.receita || 1
                const pct = Math.round((r.receita / max) * 100)
                const medals = ['🥇','🥈','🥉']
                return (
                  <div key={r.region}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.2rem' }}>
                      <span style={{ fontSize: '0.8rem', flexShrink: 0 }}>{medals[i] || `#${i+1}`}</span>
                      <span style={{ fontSize: '0.78rem', color: '#1e293b', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.region}</span>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8', flexShrink: 0 }}>{r.vendas}x</span>
                      <span style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 700, flexShrink: 0, minWidth: 65, textAlign: 'right' }}>{formatCurrency(r.receita)}</span>
                    </div>
                    <div style={{ background: '#f1f5f9', borderRadius: 99, height: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#2563eb,#4f46e5)', height: '100%', borderRadius: 99 }} />
                    </div>
                  </div>
                )
              })}
              {regionData.length === 0 && <p style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', margin: 0 }}>Sem dados</p>}
            </div>
          </Section>

          {/* Cidade → Produtos */}
          <Section title="O que cada cidade comprou">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px,1fr))', gap: '0.85rem' }}>
              {cityByProduct.slice(0, 6).map(c => (
                <div key={c.cidade} style={{ background: '#f8fafc', borderRadius: 14, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                  {/* Header da cidade */}
                  <div style={{ background: 'linear-gradient(135deg,#1e3a5f,#2563eb)', padding: '0.7rem 0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: '0.85rem' }}>📍 {c.cidade}</div>
                      <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.68rem', marginTop: '0.1rem' }}>
                        {c.totalQtd} un · {formatCurrency(c.totalReceita)}
                      </div>
                    </div>
                    <span style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 7, padding: '0.2rem 0.55rem', fontSize: '0.7rem', color: '#fff', fontWeight: 700 }}>
                      {c.produtos.length} prod.
                    </span>
                  </div>
                  {/* Produtos */}
                  <div style={{ padding: '0.65rem 0.95rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    {c.produtos.slice(0, 4).map(p => {
                      const pct = Math.round((p.qtd / (c.produtos[0]?.qtd || 1)) * 100)
                      return (
                        <div key={p.nome}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.15rem' }}>
                            <span style={{ fontSize: '0.76rem', fontWeight: 500, color: '#1e293b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '0.5rem' }}>
                              {p.nome}
                            </span>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0 }}>
                              <span style={{ fontSize: '0.68rem', background: '#eff6ff', color: '#2563eb', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>{p.qtd} un.</span>
                              <span style={{ fontSize: '0.68rem', color: '#16a34a', fontWeight: 700 }}>{formatCurrency(p.receita)}</span>
                            </div>
                          </div>
                          <div style={{ background: '#e2e8f0', borderRadius: 99, height: 3.5 }}>
                            <div style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#2563eb,#4f46e5)', height: '100%', borderRadius: 99 }} />
                          </div>
                        </div>
                      )
                    })}
                    {c.produtos.length > 4 && (
                      <div style={{ fontSize: '0.68rem', color: '#94a3b8', textAlign: 'center', paddingTop: '0.1rem' }}>
                        +{c.produtos.length - 4} outros produtos
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

    </div>
  )
}
