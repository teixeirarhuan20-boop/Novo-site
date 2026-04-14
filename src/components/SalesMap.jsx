import React, { useEffect, useRef, useMemo } from 'react'
import { unpackLocation, buildColorMap, jitter } from '../utils/location'
import { formatCurrency } from '../utils/formatting'

export function SalesMap({ transactions, inventory, isActive }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const markersRef   = useRef([])

  const sales = useMemo(() => transactions.filter(t => t.type === 'saída'), [transactions])

  const productList = useMemo(() => [
    ...new Set(sales.map(t => unpackLocation(t.itemName)?.cleanName || t.itemName.split('||')[0].trim()))
  ], [sales])

  // Mapa produto→cor por ÍNDICE — sem colisões de hash
  const colorMap = useMemo(() => buildColorMap(productList, inventory), [productList, inventory])

  useEffect(() => {
    const init = () => {
      if (!containerRef.current || mapRef.current) return
      if (!window.L) { setTimeout(init, 200); return }
      mapRef.current = window.L.map(containerRef.current).setView([-15.78, -47.93], 4)
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(mapRef.current)
      setTimeout(() => mapRef.current?.invalidateSize(), 150)
    }
    init()
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [])

  useEffect(() => {
    if (!isActive || !mapRef.current) return
    setTimeout(() => mapRef.current?.invalidateSize(), 200)
  }, [isActive])

  useEffect(() => {
    if (!mapRef.current || !window.L) return
    markersRef.current.forEach(m => mapRef.current.removeLayer(m))
    markersRef.current = []

    sales.forEach(t => {
      const loc = unpackLocation(t.itemName)
      if (!loc?.lat || !loc?.lng || isNaN(loc.lat)) return
      const color = colorMap[loc.cleanName] || '#64748b'
      const m = window.L.circleMarker([jitter(loc.lat), jitter(loc.lng)], {
        radius: 11, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.88,
      }).addTo(mapRef.current).bindPopup(`
        <div style="font-family:inherit;min-width:160px">
          <b style="color:${color};font-size:0.95rem">${loc.cleanName}</b><br>
          <span style="color:#64748b;font-size:0.78rem">👤 ${t.personName || 'Cliente'}</span><br>
          <hr style="margin:5px 0;border:0;border-top:1px solid #eee"/>
          📍 ${loc.city || '—'}<br>
          💰 <b>${formatCurrency(t.totalValue)}</b> · ${t.quantity} un.<br>
          ${loc.rastreio ? `📦 ${loc.rastreio}` : ''}
        </div>
      `)
      markersRef.current.push(m)
    })

    if (markersRef.current.length > 0) {
      mapRef.current.fitBounds(
        window.L.featureGroup(markersRef.current).getBounds().pad(0.25)
      )
    }
    setTimeout(() => mapRef.current?.invalidateSize(), 200)
  }, [sales, inventory])

  return (
    <div className="page">
      <div className="page-header">
        <h1>🗺️ Mapa de Vendas</h1>
        <p>Distribuição geográfica de todos os pedidos realizados</p>
      </div>

      {/* Legenda de produtos */}
      {productList.length > 0 && (
        <div className="flex gap-1 mb-3" style={{ flexWrap: 'wrap' }}>
          {productList.map(p => (
            <span key={p} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-full)', padding: '4px 12px',
              fontSize: '0.78rem', color: 'var(--text)',
            }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: colorMap[p] || '#64748b', flexShrink: 0,
              }} />
              {p}
            </span>
          ))}
        </div>
      )}

      {/* Mapa */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div ref={containerRef} style={{ height: 'calc(100vh - 280px)', minHeight: 400 }} />
      </div>

      {sales.filter(t => !unpackLocation(t.itemName)?.lat).length > 0 && (
        <p className="text-muted text-small mt-1">
          ⚠️ Alguns pedidos sem coordenadas — verifique se o campo "Destino" foi preenchido corretamente.
        </p>
      )}
    </div>
  )
}