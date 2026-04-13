import React, { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { unpackLocation, getProductColor, jitter } from '../utils/location'
import { formatCurrency } from '../utils/formatting'

export function Dashboard({ inventory, transactions }) {
  const [filterProduct, setFilterProduct] = useState('All')
  const [filterRegion,  setFilterRegion]  = useState('All')

  const mapRef       = useRef(null)
  const mapInstance  = useRef(null)
  const markersRef   = useRef([])

  // ── Filtragem ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = transactions
    if (filterProduct !== 'All') {
      list = list.filter(t => t.itemName.split('||')[0].trim() === filterProduct)
    }
    if (filterRegion !== 'All') {
      list = list.filter(t => {
        const loc = unpackLocation(t.itemName)
        return (loc?.city || t.city) === filterRegion
      })
    }
    return list
  }, [transactions, filterProduct, filterRegion])

  const exits = useMemo(() => filtered.filter(t => t.type === 'saída'), [filtered])

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const today            = new Date().toLocaleDateString('pt-BR')
  const totalRevenue     = useMemo(() => exits.reduce((s, t) => s + Number(t.totalValue || 0), 0), [exits])
  const totalStock       = useMemo(() => inventory.reduce((s, i) => s + Number(i.quantity || 0), 0), [inventory])
  const stockValue       = useMemo(() => inventory.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.price || 0), 0), [inventory])
  const lowStock         = useMemo(() => inventory.filter(i => Number(i.quantity) > 0 && Number(i.quantity) < 5).length, [inventory])
  const exitsToday       = useMemo(() => transactions.filter(t => t.type === 'saída' && t.date.includes(today)).length, [transactions, today])

  // ── Gráfico ────────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    const byDate = {}
    exits.forEach(t => {
      const date = t.date.split(' ')[0]
      byDate[date] = (byDate[date] || 0) + Number(t.totalValue || 0)
    })
    return Object.entries(byDate)
      .map(([date, receita]) => ({ date, receita }))
      .sort((a, b) => new Date(a.date.split('/').reverse().join('-')) - new Date(b.date.split('/').reverse().join('-')))
      .slice(-10)
  }, [exits])

  // ── Tabela de regiões ──────────────────────────────────────────────────────
  const regionData = useMemo(() => {
    const map = {}
    exits.forEach(t => {
      const loc = unpackLocation(t.itemName)
      const r   = loc?.city || t.city || 'Desconhecido'
      if (!map[r]) map[r] = { vendas: 0, receita: 0 }
      map[r].vendas++
      map[r].receita += Number(t.totalValue || 0)
    })
    return Object.entries(map)
      .map(([region, v]) => ({ region, ...v }))
      .sort((a, b) => b.receita - a.receita)
  }, [exits])

  // ── Mapa ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = () => {
      if (!mapRef.current || mapInstance.current) return
      if (!window.L) { setTimeout(init, 200); return }
      mapInstance.current = window.L.map(mapRef.current, { zoomControl: false }).setView([-15.78, -47.93], 4)
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(mapInstance.current)
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
      const color  = getProductColor(loc.cleanName, inventory)
      const marker = window.L.circleMarker([jitter(loc.lat), jitter(loc.lng)], {
        radius: 9, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9,
      }).addTo(mapInstance.current).bindPopup(`
        <b style="color:${color}">${loc.cleanName}</b><br>
        <span style="color:#64748b;font-size:0.8rem">👤 ${t.personName}</span><br>
        📍 ${loc.city} &nbsp;💰 <b>R$ ${Number(t.totalValue).toFixed(2)}</b>
      `)
      markersRef.current.push(marker)
    })

    if (markersRef.current.length > 0) {
      const group = window.L.featureGroup(markersRef.current)
      mapInstance.current.fitBounds(group.getBounds().pad(0.2))
    }
  }, [filtered])

  // ── Listas para filtros ────────────────────────────────────────────────────
  const products = useMemo(() => [...new Set(transactions.map(t => t.itemName.split('||')[0].trim()))], [transactions])
  const regions  = useMemo(() => [...new Set(transactions.map(t => {
    const loc = unpackLocation(t.itemName); return loc?.city || t.city
  }).filter(Boolean))], [transactions])

  return (
    <div className="page">
      {/* Header + Filtros */}
      <div className="flex-between mb-3">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1>📊 Dashboard</h1>
          <p>Resumo executivo do seu negócio</p>
        </div>
        <div className="flex gap-1">
          <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)} style={{ minWidth: 160 }}>
            <option value="All">Todos os Produtos</option>
            {products.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)} style={{ minWidth: 160 }}>
            <option value="All">Todas as Regiões</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">📦 Total em Estoque</span>
          <span className="stat-value">{totalStock.toLocaleString()}</span>
          <span className="stat-sub">unidades</span>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid var(--danger)' }}>
          <span className="stat-label">🔻 Saídas Hoje</span>
          <span className="stat-value color-red">{exitsToday}</span>
          <span className="stat-sub">{exitsToday > 0 ? 'pedidos entregues' : 'sem saídas'}</span>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid var(--warning)' }}>
          <span className="stat-label">⚠️ Estoque Baixo</span>
          <span className="stat-value color-orange">{lowStock}</span>
          <span className="stat-sub">itens com menos de 5 un.</span>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid var(--success)' }}>
          <span className="stat-label">💰 Valor Patrimonial</span>
          <span className="stat-value color-green" style={{ fontSize: '1.3rem' }}>{formatCurrency(stockValue)}</span>
          <span className="stat-sub">Faturado: {formatCurrency(totalRevenue)}</span>
        </div>
      </div>

      {/* Gráfico + Mapa */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
        <div className="card">
          <h3 style={{ marginBottom: '1.25rem', color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Receita por Período
          </h3>
          {chartData.length === 0 ? (
            <div className="empty-state">Sem dados para exibir</div>
          ) : (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={v => formatCurrency(v)} cursor={{ fill: 'var(--surface-2)' }} />
                  <Bar dataKey="receita" fill="var(--primary)" radius={[4, 4, 0, 0]} name="Receita" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Distribuição Geográfica
          </h3>
          <div ref={mapRef} className="map-container" style={{ height: 280, marginBottom: '1rem' }} />
          <table style={{ fontSize: '0.8rem' }}>
            <thead>
              <tr>
                <th>Região</th>
                <th>Pedidos</th>
                <th>Receita</th>
              </tr>
            </thead>
            <tbody>
              {regionData.slice(0, 4).map((r, i) => (
                <tr key={i}>
                  <td>{r.region}</td>
                  <td>{r.vendas}</td>
                  <td className="font-bold color-green">{formatCurrency(r.receita)}</td>
                </tr>
              ))}
              {regionData.length === 0 && (
                <tr><td colSpan={3} className="empty-state">Sem vendas ainda</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
