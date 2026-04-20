import React, { useEffect, useRef, useMemo, useState } from 'react'
import { unpackLocation, jitter } from '../utils/location'
import { formatCurrency } from '../utils/formatting'

// ─── Carrega scripts/CSS externos sob demanda ──────────────────────────────────
function loadCSS(href, id) {
  if (document.getElementById(id)) return
  const l = document.createElement('link')
  l.rel = 'stylesheet'; l.href = href; l.id = id
  document.head.appendChild(l)
}
function loadScript(src, id) {
  if (document.getElementById(id)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src; s.id = id
    s.onload = resolve
    s.onerror = () => reject(new Error(`Falha ao carregar ${src}`))
    document.head.appendChild(s)
  })
}

// ─── Ícone azul (DivIcon — compatível com markerClusterGroup) ─────────────────
function makeBlueIcon(L) {
  return L.divIcon({
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:#3b82f6;border:2.5px solid #fff;
      box-shadow:0 2px 8px rgba(59,130,246,0.55);
    "></div>`,
    className: '',
    iconSize:   [14, 14],
    iconAnchor: [7, 7],
    popupAnchor:[0, -10],
  })
}

// ─── Ícone de cluster azul ────────────────────────────────────────────────────
function clusterIconFn(cluster) {
  const n    = cluster.getChildCount()
  const size = n < 10 ? 36 : n < 50 ? 44 : 52
  return window.L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:rgba(37,99,235,0.88);border:3px solid #fff;
      box-shadow:0 2px 12px rgba(37,99,235,0.4);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-weight:700;font-size:${n < 10 ? 14 : 12}px;font-family:inherit;
    ">${n}</div>`,
    className:  '',
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// ─── Popup HTML ───────────────────────────────────────────────────────────────
function makePopup(t, loc) {
  const product = loc?.cleanName || t.itemName.split('||')[0].trim()
  const date    = (t.date || '').split(' ')[0]
  return `
    <div style="font-family:inherit;min-width:195px;max-width:230px;line-height:1.45">
      <div style="font-weight:700;font-size:0.9rem;color:#1e293b;margin-bottom:5px;
                  padding-bottom:5px;border-bottom:1px solid #e2e8f0">
        📦 ${product}
      </div>
      <div style="color:#475569;font-size:0.8rem;display:flex;flex-direction:column;gap:3px">
        <span>👤 ${t.personName || 'Cliente'}</span>
        <span>📍 ${loc?.city || '—'}</span>
        <div style="margin-top:4px;padding-top:4px;border-top:1px solid #f1f5f9;
                    display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:700;color:#059669;font-size:0.88rem">
            ${formatCurrency(t.totalValue)}
          </span>
          <span style="color:#94a3b8;font-size:0.75rem">${t.quantity} un.</span>
        </div>
        <span style="color:#94a3b8;font-size:0.72rem">${date}</span>
      </div>
    </div>`
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function SalesMap({ transactions, inventory, isActive }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const clusterRef   = useRef(null)
  const heatRef      = useRef(null)

  const [pluginsReady, setPluginsReady] = useState(false)
  const [heatmap,      setHeatmap]      = useState(false)

  const sales = useMemo(() => transactions.filter(t => t.type === 'saída'), [transactions])

  // ── 1. Carrega plugins CDN (markercluster + heatmap) ──────────────────────
  useEffect(() => {
    loadCSS(
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css',
      'mc-css'
    )
    loadCSS(
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css',
      'mc-default-css'
    )

    const waitAndLoad = async () => {
      while (!window.L) await new Promise(r => setTimeout(r, 100))
      await loadScript(
        'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js',
        'mc-js'
      ).catch(() => {/* funciona sem cluster */})
      await loadScript(
        'https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js',
        'lheat-js'
      ).catch(() => {/* funciona sem heatmap */})
      setPluginsReady(true)
    }
    waitAndLoad()
  }, [])

  // ── 2. Inicializa mapa após plugins prontos ───────────────────────────────
  useEffect(() => {
    if (!pluginsReady) return
    const init = () => {
      if (!containerRef.current || mapRef.current) return
      if (!window.L) { setTimeout(init, 200); return }

      mapRef.current = window.L.map(containerRef.current, { preferCanvas: true })
        .setView([-15.78, -47.93], 4)

      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(mapRef.current)

      // Cluster group
      if (window.L.markerClusterGroup) {
        clusterRef.current = window.L.markerClusterGroup({
          maxClusterRadius: 55,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          iconCreateFunction: clusterIconFn,
          chunkedLoading: true,
        })
        mapRef.current.addLayer(clusterRef.current)
      }

      setTimeout(() => mapRef.current?.invalidateSize(), 150)
    }
    init()
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
      clusterRef.current = null
    }
  }, [pluginsReady])

  // ── 3. Sincroniza marcadores e heatmap com os dados ───────────────────────
  useEffect(() => {
    if (!mapRef.current || !window.L || !pluginsReady) return

    // Limpa camadas anteriores
    clusterRef.current?.clearLayers()
    if (heatRef.current) { mapRef.current.removeLayer(heatRef.current); heatRef.current = null }

    const heatPoints = []
    const blueIcon   = makeBlueIcon(window.L)

    sales.forEach(t => {
      const loc = unpackLocation(t.itemName)
      if (!loc?.lat || !loc?.lng || isNaN(loc.lat)) return

      const lat = jitter(loc.lat)
      const lng = jitter(loc.lng)
      heatPoints.push([lat, lng, 0.8])

      const marker = window.L.marker([lat, lng], { icon: blueIcon })
        .bindPopup(makePopup(t, loc), { maxWidth: 260 })

      clusterRef.current
        ? clusterRef.current.addLayer(marker)
        : marker.addTo(mapRef.current)
    })

    // Heatmap opcional
    if (heatmap && window.L.heatLayer && heatPoints.length > 0) {
      heatRef.current = window.L.heatLayer(heatPoints, {
        radius: 28, blur: 18, maxZoom: 11,
        gradient: { 0.2: '#93c5fd', 0.5: '#3b82f6', 0.8: '#1d4ed8', 1: '#1e3a8a' },
      }).addTo(mapRef.current)
    }

    // Ajusta viewport para os pontos
    try {
      const source = clusterRef.current ?? null
      if (source && source.getLayers().length > 0) {
        mapRef.current.fitBounds(source.getBounds().pad(0.2))
      }
    } catch { /* ignora se bounds inválido */ }

    setTimeout(() => mapRef.current?.invalidateSize(), 200)
  }, [sales, pluginsReady, heatmap])

  // ── 4. Redimensiona ao trocar de aba ─────────────────────────────────────
  useEffect(() => {
    if (!isActive || !mapRef.current) return
    setTimeout(() => mapRef.current?.invalidateSize(), 200)
  }, [isActive])

  // ── Métricas ──────────────────────────────────────────────────────────────
  const mapped   = useMemo(() => sales.filter(t => unpackLocation(t.itemName)?.lat).length, [sales])
  const unmapped = sales.length - mapped

  return (
    <div className="page">
      <div className="page-header">
        <h1>🗺️ Mapa de Vendas</h1>
        <p>Distribuição geográfica de todos os pedidos realizados</p>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>

        {/* Legenda simplificada */}
        <div style={{ display: 'flex', gap: '1.1rem', alignItems: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 12, height: 12, borderRadius: '50%',
              background: '#3b82f6', border: '2px solid #fff',
              boxShadow: '0 1px 5px rgba(59,130,246,0.4)',
              display: 'inline-block', flexShrink: 0,
            }} />
            1 venda
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'rgba(37,99,235,0.85)', border: '2px solid #fff',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: '0.68rem', fontWeight: 700, flexShrink: 0,
            }}>N</span>
            múltiplas vendas
          </span>
        </div>

        {/* Controles */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setHeatmap(v => !v)}
            className={`btn btn-sm ${heatmap ? 'btn-primary' : 'btn-secondary'}`}
            title="Mapa de calor de densidade de vendas"
          >
            🌡️ Heatmap {heatmap ? 'ON' : 'OFF'}
          </button>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {mapped} venda{mapped !== 1 ? 's' : ''} mapeada{mapped !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Mapa ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
        {!pluginsReady && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface)', color: 'var(--text-muted)', fontSize: '0.82rem', gap: '0.4rem',
          }}>
            ⏳ Carregando mapa...
          </div>
        )}
        <div ref={containerRef} style={{ height: 'calc(100vh - 290px)', minHeight: 420 }} />
      </div>

      {unmapped > 0 && (
        <p className="text-muted text-small mt-1">
          ⚠️ {unmapped} pedido{unmapped !== 1 ? 's' : ''} sem coordenadas — verifique o campo "Destino" nos pedidos.
        </p>
      )}
    </div>
  )
}
