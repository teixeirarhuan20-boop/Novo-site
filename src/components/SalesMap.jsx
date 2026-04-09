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
  const [filteredTransactions, setFilteredTransactions] = useState(transactions);

  // --- LOGICA DE FILTRO ---
  useEffect(() => {
    let filtered = transactions;
    if (selectedProduct !== 'All') {
      filtered = filtered.filter(t => {
        const name = t.itemName.split('||')[0].trim();
        return name === selectedProduct;
      });
    }
    if (selectedRegion !== 'All') {
      filtered = filtered.filter(t => {
        const loc = unpackLocation(t.itemName);
        return (loc?.city || t.city) === selectedRegion;
      });
    }
    if (dateRange !== 'all') {
      const days = dateRange === '7d' ? 7 : 30;
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - days);
      
      filtered = filtered.filter(t => {
        // Converte DD/MM/AAAA para objeto Date
        const [day, month, year] = t.date.split(' ')[0].split('/');
        const transactionDate = new Date(`${year}-${month}-${day}`);
        return transactionDate >= limitDate;
      });
    }
    setFilteredTransactions(filtered);
  }, [transactions, selectedProduct, selectedRegion, dateRange]);

  // LÓGICA DE DESEMPACOTAMENTO (SMART STRING)
  // Formato: "NomeProduto ||Cidade;Lat;Lng;OrderID;NF;CEP;Endereco||"
  const unpackLocation = (itemName) => {
    if (!itemName || typeof itemName !== 'string') return null;
    // Extrai tudo que está entre || e ||
    const innerMatch = itemName.match(/\|\|(.+?)\|\|/);
    if (innerMatch) {
      const parts = innerMatch[1].split(';');
      return {
        cleanName: itemName.replace(/\|\|.*?\|\|/, '').trim(),
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

  const applyJitter = (coord) => coord + (Math.random() - 0.5) * 0.01;

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

  // --- DADOS PARA A TABELA DE REGIOES ---
  const regionData = filteredTransactions.reduce((acc, t) => {
    const loc = unpackLocation(t.itemName);
    if (!loc) return acc;
    const region = loc.city || 'Desconhecido';
    const existingIndex = acc.findIndex(r => r.region === region);
    if (existingIndex > -1) {
      acc[existingIndex].vendas += 1;
      acc[existingIndex].receita += Number(t.totalValue) || 0;
      if (!acc[existingIndex].products.includes(loc.cleanName)) {
        acc[existingIndex].products.push(loc.cleanName);
      }
    } else {
      acc.push({ region, vendas: 1, receita: Number(t.totalValue) || 0, products: [loc.cleanName] });
    }
    return acc;
  }, []).sort((a, b) => b.receita - a.receita);

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


    markersRef.current.forEach(m => mapInstanceRef.current.removeLayer(m));
    markersRef.current = [];

    let count = 0;
    filteredTransactions.forEach(t => {
      const loc = unpackLocation(t.itemName);
      if (loc && loc.lat && loc.lng && !isNaN(loc.lat) && !isNaN(loc.lng)) {
        count++;
        const color = getProductColor(loc.cleanName);
        const finalLat = applyJitter(loc.lat);
        const finalLng = applyJitter(loc.lng);

        const marker = window.L.circleMarker([finalLat, finalLng], {
          radius: 10,
          fillColor: color,
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9,
          className: 'static-marker'
        }).addTo(mapInstanceRef.current)
          .bindPopup(`
            <div style="font-family: inherit;">
              <b style="font-size: 1rem;">${loc.cleanName}</b><br/>
              <span style="color: #64748b; font-size: 0.85rem;">👤 ${t.personName || 'Cliente'}</span><br/>
              <hr style="margin: 5px 0; border: 0; border-top: 1px solid #eee;" />
              <span style="font-size: 0.85rem;">📍 ${loc.city}</span><br/>
              <b style="color: #16a34a;">R$ ${Number(t.totalValue).toFixed(2)}</b>
            </div>
          `);
        markersRef.current.push(marker);
      }
    });

    setMappedCount(count);

    if (markersRef.current.length > 0) {
      const group = new window.L.featureGroup(markersRef.current);
      mapInstanceRef.current.fitBounds(group.getBounds().pad(0.3));
    }
  }, [filteredTransactions]);

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
