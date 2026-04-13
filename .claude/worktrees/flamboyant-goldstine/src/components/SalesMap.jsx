import React, { useEffect, useState, useRef } from 'react';

export function SalesMap({ transactions = [], inventory = [], isActive = false }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const clusterGroupRef = useRef(null);
  const heatLayerRef = useRef(null);
  
  const [mappedCount, setMappedCount] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState('All');
  const [selectedRegion, setSelectedRegion] = useState('All');
  const [dateRange, setDateRange] = useState('all'); // '7d', '30d', 'all'
  const [mapMode, setMapMode] = useState('cluster'); // 'pins', 'cluster', 'heat'

  // 1. Memoização do Unpack (Processa as smart strings uma única vez por transação)
  const enrichedTransactions = useMemo(() => {
    return transactions.map(t => {
      const loc = unpackLocation(t.item_name || t.itemName);
      
      // Pré-calcula a data para evitar split/new Date repetitivo no filtro
      let dateObj = null;
      if (t.date) {
        const [day, month, year] = t.date.split(' ')[0].split('/');
        dateObj = new Date(`${year}-${month}-${day}`).getTime();
      }

      return {
        ...t,
        parsedLoc: loc,
        cleanName: loc?.cleanName || t.itemName?.split('||')[0].trim() || 'Desconhecido',
        timestamp: dateObj,
        city: loc?.city || t.city || 'Desconhecido'
      };
    });
  }, [transactions]);

  // 2. Lógica de Filtro Otimizada (Síncrona via useMemo)
  const filteredTransactions = useMemo(() => {
    let filtered = enrichedTransactions;

    if (selectedProduct !== 'All') {
      filtered = filtered.filter(t => t.cleanName === selectedProduct);
    }

    if (selectedRegion !== 'All') {
      filtered = filtered.filter(t => t.city === selectedRegion);
    }

    if (dateRange !== 'all') {
      const days = dateRange === '7d' ? 7 : 30;
      const limitDate = new Date().getTime() - (days * 24 * 60 * 60 * 1000);
      
      filtered = filtered.filter(t => t.timestamp && t.timestamp >= limitDate);
    }

    return filtered;
  }, [enrichedTransactions, selectedProduct, selectedRegion, dateRange]);

  // 3. Resumo de Performance por Localidade (Otimizado)
  const regionData = useMemo(() => {
    const data = filteredTransactions.reduce((acc, t) => {
      const region = t.city;
      if (!acc[region]) {
        acc[region] = { region, vendas: 0, receita: 0, products: new Set() };
      }
      acc[region].vendas += 1;
      acc[region].receita += Number(t.totalValue) || 0;
      acc[region].products.add(t.cleanName);
      return acc;
    }, {});

    return Object.values(data)
      .map(item => ({
        ...item,
        products: Array.from(item.products)
      }))
      .sort((a, b) => b.receita - a.receita);
  }, [filteredTransactions]);

  // Atualiza o contador de mapeados para a UI
  useEffect(() => {
    const count = filteredTransactions.filter(t => t.parsedLoc?.lat && t.parsedLoc?.lng).length;
    setMappedCount(count);
  }, [filteredTransactions]);

  // LÓGICA DE DESEMPACOTAMENTO (SMART STRING)
  // Mantida como helper, mas agora chamada apenas na memoização inicial
  const unpackLocation = (itemName) => {
    if (!itemName || typeof itemName !== 'string') return null;
    // Extrai tudo que está entre || e ||
    const innerMatch = itemName.match(/\s*\|\|\s*(.*?)\s*\|\|\s*/);
    if (innerMatch) {
      const parts = innerMatch[1].split(';').map(p => p.trim());
      return {
        cleanName: itemName.replace(/\s*\|\|.*?\|\|\s*/, '').trim(),
        city: parts[0] || null,
        lat: parts[1] && parts[1] !== 'null' ? Number(parts[1]) : null,
        lng: parts[2] && parts[2] !== 'null' ? Number(parts[2]) : null,
        orderId: parts[3] || null,
        nf: parts[4] || null,
        cep: parts[5] || null,
        address: parts[6] || null,
      };
    }
    // Fallback para formato legado [Cidade]
    const oldMatch = itemName.match(/\[(.*?)\]/);
    if (oldMatch) {
      return {
        cleanName: itemName.replace(/\[.*?\]/, '').trim(),
        city: oldMatch[1],
        lat: null,
        lng: null
      };
    }
    return null;
  };

  const applyJitter = (coord, id = '0') => {
    // Jitter determinístico baseado no ID para evitar que os pontos "pulem" ao atualizar
    let hash = 0;
    const str = String(id);
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const offset = ((Math.abs(hash) % 100) / 100 - 0.5) * 0.005;
    return coord + offset;
  };

  const colorPalette = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];
  const getProductColor = (productName) => {
    // Busca no inventário ignorando maiúsculas/minúsculas
    const inInv = inventory.find(i => i.name.toLowerCase().trim() === productName.toLowerCase().trim());
    if (inInv && inInv.color) return inInv.color;

    let hash = 0;
    for (let i = 0; i < productName.length; i++) {
        hash = productName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colorPalette[Math.abs(hash) % colorPalette.length];
  };


  // Inicializa o mapa quando a aba fica visível pela primeira vez
  useEffect(() => {
    if (!isActive) return;

    const initMap = () => {
      if (!mapContainerRef.current || mapInstanceRef.current) return;
      if (!window.L) {
        // Leaflet ainda não carregou — tenta novamente em 200ms
        setTimeout(initMap, 200);
        return;
      }
      mapInstanceRef.current = window.L.map(mapContainerRef.current).setView([-15.7801, -47.9292], 4);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(mapInstanceRef.current);

      // Força recálculo de tamanho logo após criar
      setTimeout(() => {
        if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize();
      }, 100);
    };

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isActive]);

  // Sempre que a aba ficar visível novamente, corrige o tamanho do mapa
  useEffect(() => {
    if (!isActive) return;
    const timer = setTimeout(() => {
      if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize();
    }, 150);
    return () => clearTimeout(timer);
  }, [isActive]);

  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;

    // Limpa camadas anteriores
    if (clusterGroupRef.current) mapInstanceRef.current.removeLayer(clusterGroupRef.current);
    if (heatLayerRef.current) mapInstanceRef.current.removeLayer(heatLayerRef.current);
    markersRef.current.forEach(m => mapInstanceRef.current.removeLayer(m));
    markersRef.current = [];

    const heatPoints = [];
    const clusterGroup = window.L.markerClusterGroup ? window.L.markerClusterGroup() : null;
    
    let count = 0;
    filteredTransactions.forEach(t => {
      const loc = t.parsedLoc;
      if (loc && loc.lat && loc.lng && !isNaN(loc.lat) && !isNaN(loc.lng)) {
        count++;
        const color = getProductColor(t.cleanName);
        const finalLat = applyJitter(loc.lat, t.id);
        const finalLng = applyJitter(loc.lng, t.id);

        // Define o marcador (Pin colorido mais visível)
        const marker = window.L.circleMarker([finalLat, finalLng], {
          radius: 12, 
          fillColor: color,
          color: '#ffffff',
          weight: 3, 
          opacity: 1,
          fillOpacity: 0.9,
          className: 'static-marker' // Removido pulse-marker para parar de balançar
        }).bindPopup(`
          <div style="font-family: inherit; min-width: 150px;">
            <b style="font-size: 1.1rem; color: ${color};">${t.cleanName}</b><br/>
            <span style="color: #64748b; font-size: 0.85rem;">👤 ${t.personName || 'Cliente'}</span><br/>
            <hr style="margin: 8px 0; border: 0; border-top: 1px solid #e2e8f0;" />
            <span style="font-size: 0.9rem;">📍 ${loc.city || 'Localização'}</span><br/>
            <b style="color: #16a34a; font-size: 1rem;">R$ ${Number(t.totalValue).toFixed(2)}</b>
          </div>
        `);

        if (mapMode === 'pins') {
          marker.addTo(mapInstanceRef.current);
          markersRef.current.push(marker);
        } else if (mapMode === 'cluster' && clusterGroup) {
          clusterGroup.addLayer(marker);
        }
        
        heatPoints.push([finalLat, finalLng, 0.5]);
      }
    });

    // Adiciona a camada correta dependendo do modo
    if (mapMode === 'cluster' && clusterGroup) {
      mapInstanceRef.current.addLayer(clusterGroup);
      clusterGroupRef.current = clusterGroup;
    } else if (mapMode === 'heat' && window.L.heatLayer) {
      const heat = window.L.heatLayer(heatPoints, { radius: 25, blur: 15, maxZoom: 10 }).addTo(mapInstanceRef.current);
      heatLayerRef.current = heat;
    }

    // Ajusta o zoom para os pontos
    if (count > 0) {
      const bounds = mapMode === 'cluster' ? clusterGroup.getBounds() : (mapMode === 'heat' ? window.L.latLngBounds(heatPoints.map(p => [p[0], p[1]])) : window.L.featureGroup(markersRef.current).getBounds());
      if (bounds.isValid()) {
        mapInstanceRef.current.fitBounds(bounds.pad(0.3));
      }
    }
    
    // Corrige tamanho
    setTimeout(() => mapInstanceRef.current?.invalidateSize(), 200);
  }, [filteredTransactions, mapMode]);

  return (
    <div className="inventory-panel" style={{ background: '#f8fafc' }}>
      <div className="bi-header">
        <div>
           <h1 style={{ color: '#1e293b' }}>🗺️ Centro de Inteligência Geográfica</h1>
           <p style={{ color: '#64748b' }}>Análise de performance com filtros avançados.</p>
        </div>
        <div className="bi-filter-bar" style={{ margin: 0 }}>
          <div className="bi-filter-group" style={{ minWidth: '120px' }}>
            <label>PRODUTO</label>
            <select value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
              <option value="All">Todos</option>
              {[...new Set(transactions.map(t => t.itemName.split('||')[0].trim()))].map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="bi-filter-group" style={{ minWidth: '120px' }}>
            <label>REGIÃO</label>
            <select value={selectedRegion} onChange={(e) => setSelectedRegion(e.target.value)}>
              <option value="All">Todas</option>
              {[...new Set(transactions.map(t => unpackLocation(t.itemName)?.city || t.city))].filter(r => r).map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="bi-filter-group" style={{ minWidth: '120px' }}>
            <label>PERÍODO</label>
            <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
              <option value="all">Todo o histórico</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
            </select>
          </div>
          <div className="bi-filter-group" style={{ minWidth: '140px' }}>
            <label>VISUALIZAÇÃO</label>
            <div style={{ display: 'flex', gap: '5px', background: '#fff', padding: '2px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
               <button onClick={() => setMapMode('cluster')} style={{ flex: 1, border: 'none', background: mapMode === 'cluster' ? '#3b82f6' : 'transparent', color: mapMode === 'cluster' ? '#fff' : '#64748b', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', padding: '5px' }}>📦 Cluster</button>
               <button onClick={() => setMapMode('pins')} style={{ flex: 1, border: 'none', background: mapMode === 'pins' ? '#3b82f6' : 'transparent', color: mapMode === 'pins' ? '#fff' : '#64748b', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', padding: '5px' }}>📍 Pins</button>
               <button onClick={() => setMapMode('heat')} style={{ flex: 1, border: 'none', background: mapMode === 'heat' ? '#3b82f6' : 'transparent', color: mapMode === 'heat' ? '#fff' : '#64748b', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', padding: '5px' }}>🔥 Calor</button>
            </div>
          </div>
        </div>
      </div>

      <div className="bi-map-container" style={{ marginBottom: '2rem' }}>
        <div ref={mapContainerRef} style={{ height: '500px', borderRadius: '12px' }}></div>
      </div>

      <div className="bi-card">
        <h3 style={{ marginBottom: '1.5rem', fontSize: '1.1rem', color: '#1e293b' }}>Resumo de Performance por Localidade</h3>
        <table className="bi-data-table">
          <thead>
            <tr>
              <th>Região / Cidade</th>
              <th>Vendas</th>
              <th>Receita Bruta</th>
              <th>Produtos (Cores)</th>
            </tr>
          </thead>
          <tbody>
            {regionData.map((r, i) => (
              <tr key={i}>
                <td style={{ fontWeight: '600' }}>{r.region}</td>
                <td>{r.vendas} un.</td>
                <td style={{ color: '#2e7d32', fontWeight: 'bold' }}>R$ {r.receita.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {r.products.map(p => (
                      <div 
                        key={p} 
                        className="bi-color-indicator" 
                        style={{ backgroundColor: getProductColor(p) }}
                        title={p}
                      ></div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {regionData.length === 0 && (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Nenhum dado encontrado para os filtros selecionados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
