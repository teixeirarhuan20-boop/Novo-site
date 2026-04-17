import React, { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { unpackLocation, buildColorMap, jitter } from '../utils/location'
import { formatCurrency } from '../utils/formatting'

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, color = '#3b82f6', onClick, active }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        borderRadius: 16,
        padding: '1.25rem 1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        borderTop: `3px solid ${color}`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s, transform 0.15s',
        ...(active ? { boxShadow: `0 0 0 2px ${color}40, 0 4px 12px rgba(0,0,0,0.08)` } : {}),
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.transform = 'translateY(-1px)')}
      onMouseLeave={e => onClick && (e.currentTarget.style.transform = '')}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '1.5rem',
          background: `${color}18`,
          borderRadius: 10,
          width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</span>
        {onClick && (
          <span style={{ fontSize: '0.65rem', color, background: `${color}15`, padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>
            {active ? 'fechar ▲' : 'ver ▼'}
          </span>
        )}
      </div>
      <span style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1, marginTop: '0.25rem' }}>
        {value}
      </span>
      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {label}
      </span>
      {sub && <span style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.1rem' }}>{sub}</span>}
    </div>
  )
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
      <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>
        {children}
      </h2>
      {right}
    </div>
  )
}

export function Dashboard({ inventory, transactions, pessoas = [], prospectionLeads = [] }) {
  const [filterProduct, setFilterProduct] = useState('All')
  const [filterRegion,  setFilterRegion]  = useState('All')
  const [filterGender,  setFilterGender]  = useState('All')
  const [chartItem,     setChartItem]     = useState('All')
  const [chartCity,     setChartCity]     = useState('All')
  const [showLowStock,  setShowLowStock]  = useState(false)

  const mapRef      = useRef(null)
  const mapInstance = useRef(null)
  const markersRef  = useRef([])

  // ── Cálculos ───────────────────────────────────────────────────────────────
  const genderMap = useMemo(() => {
    const m = {}
    pessoas.forEach(p => { if (p.gender) m[p.name] = p.gender })
    return m
  }, [pessoas])

  const filtered = useMemo(() => {
    let list = transactions
    if (filterProduct !== 'All') list = list.filter(t => t.itemName.split('||')[0].trim() === filterProduct)
    if (filterRegion  !== 'All') list = list.filter(t => { const loc = unpackLocation(t.itemName); return (loc?.city || t.city) === filterRegion })
    if (filterGender  !== 'All') list = list.filter(t => (genderMap[t.personName] || '') === filterGender)
    return list
  }, [transactions, filterProduct, filterRegion, filterGender, genderMap])

  const exits = useMemo(() => filtered.filter(t => t.type === 'saída'), [filtered])

  const today         = new Date().toLocaleDateString('pt-BR')
  const totalRevenue  = useMemo(() => exits.reduce((s, t) => s + Number(t.totalValue || 0), 0), [exits])
  const totalStock    = useMemo(() => inventory.reduce((s, i) => s + Number(i.quantity || 0), 0), [inventory])
  const stockValue    = useMemo(() => inventory.reduce((s, i) => s + Number(i.quantity||0)*Number(i.price||0), 0), [inventory])
  const lowStockItems = useMemo(() => inventory.filter(i => Number(i.quantity) > 0 && Number(i.quantity) < 5).sort((a,b) => Number(a.quantity)-Number(b.quantity)), [inventory])
  const exitsToday    = useMemo(() => transactions.filter(t => t.type === 'saída' && t.date.includes(today)).length, [transactions, today])

  const chartExits = useMemo(() => {
    let list = exits
    if (chartItem !== 'All') list = list.filter(t => t.itemName.split('||')[0].trim() === chartItem)
    if (chartCity !== 'All') list = list.filter(t => { const loc = unpackLocation(t.itemName); return (loc?.city||t.city) === chartCity })
    return list
  }, [exits, chartItem, chartCity])

  const chartData = useMemo(() => {
    const m = {}
    chartExits.forEach(t => { const d = t.date.split(' ')[0]; m[d] = (m[d]||0) + Number(t.totalValue||0) })
    return Object.entries(m)
      .map(([date, receita]) => ({ date, receita }))
      .sort((a,b) => new Date(a.date.split('/').reverse().join('-')) - new Date(b.date.split('/').reverse().join('-')))
      .slice(-14)
  }, [chartExits])

  const regionData = useMemo(() => {
    const m = {}
    exits.forEach(t => {
      const loc = unpackLocation(t.itemName)
      const r = loc?.city || t.city || 'Desconhecido'
      if (!m[r]) m[r] = { vendas: 0, receita: 0 }
      m[r].vendas++; m[r].receita += Number(t.totalValue||0)
    })
    return Object.entries(m).map(([region, v]) => ({ region, ...v })).sort((a,b) => b.receita - a.receita)
  }, [exits])

  const cityByProduct = useMemo(() => {
    const m = {}
    exits.forEach(t => {
      const loc  = unpackLocation(t.itemName)
      const prod = loc?.cleanName || t.itemName.split('||')[0].trim()
      const city = loc?.city || t.city || null
      if (!city) return
      if (!m[city]) m[city] = { cidade: city, totalQtd: 0, totalReceita: 0, produtos: {} }
      if (!m[city].produtos[prod]) m[city].produtos[prod] = { qtd: 0, receita: 0 }
      m[city].produtos[prod].qtd     += Number(t.quantity||1)
      m[city].produtos[prod].receita += Number(t.totalValue||0)
      m[city].totalQtd               += Number(t.quantity||1)
      m[city].totalReceita           += Number(t.totalValue||0)
    })
    return Object.values(m).sort((a,b) => b.totalReceita - a.totalReceita)
      .map(c => ({ ...c, produtos: Object.entries(c.produtos).map(([nome,v]) => ({ nome, ...v })).sort((a,b) => b.qtd-a.qtd) }))
  }, [exits])

  const products  = useMemo(() => [...new Set(transactions.map(t => t.itemName.split('||')[0].trim()))], [transactions])
  const regions   = useMemo(() => [...new Set(transactions.map(t => { const loc = unpackLocation(t.itemName); return loc?.city||t.city }).filter(Boolean))], [transactions])
  // colorMap garante cor única por produto — mesma lógica do SalesMap
  const colorMap  = useMemo(() => {
    const names = [...new Set(exits.map(t => { const loc = unpackLocation(t.itemName); return loc?.cleanName || t.itemName.split('||')[0].trim() }))]
    return buildColorMap(names, inventory)
  }, [exits, inventory])

  // ── Mapa ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = () => {
      if (!mapRef.current || mapInstance.current) return
      if (!window.L) { setTimeout(init, 200); return }
      mapInstance.current = window.L.map(mapRef.current, { zoomControl: false }).setView([-15.78,-47.93], 4)
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(mapInstance.current)
      setTimeout(() => mapInstance.current?.invalidateSize(), 150)
    }
    init()
    return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null } }
  }, [])

  useEffect(() => {
    if (!mapInstance.current || !window.L) return
    markersRef.current.forEach(m => mapInstance.current.removeLayer(m))
    markersRef.current = []

    exits.forEach(t => {
      const loc = unpackLocation(t.itemName)
      if (!loc?.lat || !loc?.lng || isNaN(loc.lat)) return
      const color = colorMap[loc.cleanName] || '#64748b'
      const m = window.L.circleMarker([jitter(loc.lat), jitter(loc.lng)], {
        radius: 9, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9,
      }).addTo(mapInstance.current).bindPopup(`
        <b style="color:${color}">${loc.cleanName}</b><br>
        <span style="color:#64748b;font-size:0.8rem">👤 ${t.personName}</span><br>
        📍 ${loc.city} &nbsp;💰 <b>R$ ${Number(t.totalValue).toFixed(2)}</b>
      `)
      markersRef.current.push(m)
    })

    prospectionLeads.filter(l => l._lat && l._lon).forEach(lead => {
      const nearSale = exits.some(t => {
        const loc = unpackLocation(t.itemName)
        if (!loc?.lat || !loc?.lng) return false
        const dlat = (loc.lat - lead._lat) * 111
        const dlng = (loc.lng - lead._lon) * 111 * Math.cos(lead._lat * Math.PI / 180)
        return Math.sqrt(dlat*dlat + dlng*dlng) < 50
      })
      const icon = window.L.divIcon({
        className: '',
        html: `<div style="background:${nearSale?'#f59e0b':'#8b5cf6'};border:2px solid #fff;border-radius:50%;width:14px;height:14px;box-shadow:0 0 0 3px ${nearSale?'rgba(245,158,11,0.3)':'rgba(139,92,246,0.3)'}"></div>`,
        iconSize: [14,14], iconAnchor: [7,7],
      })
      const m = window.L.marker([lead._lat, lead._lon], { icon }).addTo(mapInstance.current)
        .bindPopup(`<b style="color:${nearSale?'#f59e0b':'#8b5cf6'}">${nearSale?'🏢 Possível Empresa':'🔍 Lead Prospectado'}</b><br>${lead.nome}<br><span style="color:#64748b;font-size:0.78rem">📍 ${lead.cidade||''} ${lead.estado||''}</span>${lead.telefone?`<br>📞 ${lead.telefone}`:''}`)
      markersRef.current.push(m)
    })

    if (markersRef.current.length > 0)
      mapInstance.current.fitBounds(window.L.featureGroup(markersRef.current).getBounds().pad(0.2))
  }, [filtered, prospectionLeads, colorMap])

  const hasFilters = filterProduct !== 'All' || filterRegion !== 'All' || filterGender !== 'All'

  return (
    <div className="page" style={{ maxWidth: 1200, margin: '0 auto' }}>

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>Dashboard</h1>
          <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginTop: '0.2rem' }}>
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        {/* Filtro de gênero — pill tabs */}
        <div style={{ display: 'flex', gap: '0.35rem', background: '#f1f5f9', borderRadius: 10, padding: '0.25rem' }}>
          {[['All','Todos'],['M','♂ Masc'],['F','♀ Fem'],['O','⚧ Outro']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilterGender(v)}
              style={{
                padding: '0.3rem 0.75rem', border: 'none', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                background: filterGender === v ? '#fff' : 'transparent',
                color: filterGender === v ? '#2563eb' : '#64748b',
                boxShadow: filterGender === v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ══ FILTROS SECUNDÁRIOS ══════════════════════════════════════════════ */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Filtrar:</span>
        {[
          { value: filterProduct, set: setFilterProduct, opts: products, placeholder: 'Produto' },
          { value: filterRegion,  set: setFilterRegion,  opts: regions,  placeholder: 'Região'  },
        ].map(({ value, set, opts, placeholder }) => (
          <select
            key={placeholder}
            value={value}
            onChange={e => set(e.target.value)}
            style={{
              fontSize: '0.78rem', padding: '0.35rem 0.75rem', borderRadius: 8,
              border: value !== 'All' ? '1.5px solid #2563eb' : '1.5px solid #e2e8f0',
              background: value !== 'All' ? '#eff6ff' : '#fff',
              color: value !== 'All' ? '#2563eb' : '#374151',
              fontWeight: value !== 'All' ? 600 : 400, cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="All">Todos {placeholder}s</option>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
        {hasFilters && (
          <button
            onClick={() => { setFilterProduct('All'); setFilterRegion('All'); setFilterGender('All') }}
            style={{ fontSize: '0.72rem', padding: '0.35rem 0.65rem', borderRadius: 8, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}
          >
            ✕ Limpar filtros
          </button>
        )}
      </div>

      {/* ══ KPIs ═══════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
        <KpiCard icon="📦" label="Total em Estoque" value={totalStock.toLocaleString('pt-BR')} sub="unidades disponíveis" color="#3b82f6" />
        <KpiCard icon="🚀" label="Saídas Hoje" value={exitsToday} sub={exitsToday > 0 ? 'pedidos entregues' : 'nenhuma saída'} color="#ef4444" />
        <KpiCard
          icon="⚠️" label="Estoque Baixo" value={lowStockItems.length}
          sub="clique para ver itens" color="#f59e0b"
          onClick={() => setShowLowStock(v => !v)} active={showLowStock}
        />
        <KpiCard icon="💰" label="Valor Patrimonial" value={formatCurrency(stockValue)} sub={`Faturado: ${formatCurrency(totalRevenue)}`} color="#10b981" />
      </div>

      {/* ══ PAINEL ESTOQUE BAIXO ════════════════════════════════════════════ */}
      {showLowStock && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 16,
          padding: '1.25rem 1.5rem', marginBottom: '1.75rem',
          animation: 'fadeIn 0.2s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span style={{ fontWeight: 700, color: '#92400e', fontSize: '0.9rem' }}>
              ⚠️ Produtos com menos de 5 unidades
            </span>
            <button onClick={() => setShowLowStock(false)} style={{ background: 'none', border: 'none', color: '#b45309', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {lowStockItems.map(i => (
              <div key={i.id} style={{
                background: '#fff', border: '1px solid #fde68a', borderRadius: 10,
                padding: '0.5rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.6rem',
              }}>
                <span style={{ fontSize: '1.1rem', background: '#fef3c7', borderRadius: 6, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📦</span>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1e293b' }}>{i.name}</div>
                  <div style={{ fontSize: '0.7rem', color: '#f59e0b', fontWeight: 700 }}>{i.quantity} un. restantes</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ GRÁFICO + MAPA ══════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '1.25rem', marginBottom: '1.75rem' }}>

        {/* Gráfico */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <SectionTitle right={
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <select value={chartItem} onChange={e => setChartItem(e.target.value)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#374151', cursor: 'pointer' }}>
                <option value="All">Todos itens</option>
                {products.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={chartCity} onChange={e => setChartCity(e.target.value)} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#374151', cursor: 'pointer' }}>
                <option value="All">Todas cidades</option>
                {regions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              {(chartItem !== 'All' || chartCity !== 'All') && (
                <button onClick={() => { setChartItem('All'); setChartCity('All') }} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: 6, border: '1px solid #fca5a5', background: 'none', color: '#dc2626', cursor: 'pointer' }}>✕</button>
              )}
            </div>
          }>
            Receita por Período
          </SectionTitle>

          {chartData.length === 0 ? (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
              Sem vendas no período
            </div>
          ) : (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} width={45} />
                  <Tooltip
                    formatter={v => [formatCurrency(v), 'Receita']}
                    contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '0.8rem' }}
                    cursor={{ fill: '#f8fafc', radius: 6 }}
                  />
                  <Bar dataKey="receita" fill="#2563eb" radius={[6,6,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Mapa */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <SectionTitle right={
            prospectionLeads.filter(l => l._lat).length > 0 && (
              <div style={{ display: 'flex', gap: '0.6rem', fontSize: '0.68rem', color: '#64748b' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />Possível empresa</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6', display: 'inline-block' }} />Lead</span>
              </div>
            )
          }>
            Distribuição Geográfica
          </SectionTitle>

          <div ref={mapRef} style={{ height: 180, borderRadius: 10, overflow: 'hidden', marginBottom: '0.85rem' }} />

          {/* Top regiões */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {regionData.slice(0, 4).map((r, i) => {
              const max = regionData[0]?.receita || 1
              const pct = Math.round((r.receita / max) * 100)
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', minWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.region}
                  </span>
                  <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #2563eb, #4f46e5)', height: '100%', borderRadius: 99 }} />
                  </div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#16a34a', minWidth: 70, textAlign: 'right' }}>
                    {formatCurrency(r.receita)}
                  </span>
                </div>
              )
            })}
            {regionData.length === 0 && <p style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center' }}>Sem dados</p>}
          </div>
        </div>
      </div>

      {/* ══ CIDADE → PRODUTOS ══════════════════════════════════════════════ */}
      {cityByProduct.length > 0 && (
        <div>
          <SectionTitle>O que cada cidade comprou</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {cityByProduct.map(c => (
              <div key={c.cidade} style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                {/* Cabeçalho da cidade */}
                <div style={{ background: 'linear-gradient(135deg, #1e3a5f, #2563eb)', padding: '0.85rem 1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem' }}>📍 {c.cidade}</div>
                    <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.7rem', marginTop: '0.1rem' }}>
                      {c.totalQtd} unidades · {formatCurrency(c.totalReceita)}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 8, padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: '#fff', fontWeight: 700 }}>
                    {c.produtos.length} produto{c.produtos.length > 1 ? 's' : ''}
                  </div>
                </div>
                {/* Lista de produtos */}
                <div style={{ padding: '0.75rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {c.produtos.map(p => {
                    const maxQtd = c.produtos[0]?.qtd || 1
                    const pct = Math.round((p.qtd / maxQtd) * 100)
                    return (
                      <div key={p.nome}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#1e293b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '0.5rem' }}>
                            {p.nome}
                          </span>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                            <span style={{ fontSize: '0.72rem', background: '#eff6ff', color: '#2563eb', padding: '1px 7px', borderRadius: 99, fontWeight: 700 }}>
                              {p.qtd} un.
                            </span>
                            <span style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 700 }}>
                              {formatCurrency(p.receita)}
                            </span>
                          </div>
                        </div>
                        <div style={{ background: '#f1f5f9', borderRadius: 99, height: 4 }}>
                          <div style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #2563eb, #4f46e5)', height: '100%', borderRadius: 99, transition: 'width 0.4s ease' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
