import React, { useEffect, useState, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export function Dashboard({ inventory, transactions }) {
  const [filteredTransactions, setFilteredTransactions] = useState(transactions);
  const [selectedProduct, setSelectedProduct] = useState('All');
  const [selectedRegion, setSelectedRegion] = useState('All');

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

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
    setFilteredTransactions(filtered);
  }, [transactions, selectedProduct, selectedRegion]);

  // --- CALCULOS BI ---
  const totalRevenue = filteredTransactions.reduce((acc, t) => acc + (Number(t.totalValue) || 0), 0);
  const totalSales = filteredTransactions.filter(t => t.type === 'saída').length;
  const avgTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
  const totalProducts = [...new Set(filteredTransactions.map(t => t.itemName.split('||')[0].trim()))].length;

  // --- DADOS PARA O GRAFICO ---
  const chartData = filteredTransactions.reduce((acc, t) => {
    const date = t.date.split(' ')[0];
    const existing = acc.find(d => d.date === date);
    if (existing) {
      existing.receita += Number(t.totalValue) || 0;
    } else {
      acc.push({ date, receita: Number(t.totalValue) || 0 });
    }
    return acc;
  }, []).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-7);

  // --- DADOS PARA A TABELA DE REGIOES ---
  const regionData = filteredTransactions.reduce((acc, t) => {
    const loc = unpackLocation(t.itemName);
    const region = loc?.city || t.city || 'Desconhecido';
    const existingIndex = acc.findIndex(r => r.region === region);
    if (existingIndex > -1) {
      acc[existingIndex].vendas += 1;
      acc[existingIndex].receita += Number(t.totalValue) || 0;
    } else {
      acc.push({ region, vendas: 1, receita: Number(t.totalValue) || 0 });
    }
    return acc;
  }, []).sort((a, b) => b.receita - a.receita);

  // LÓGICA DE DESEMPACOTAMENTO (SMART STRING)
  // Formato: "NomeProduto ||Cidade;Lat;Lng;OrderID;NF;CEP;Endereco||"
  function unpackLocation(itemName) {
    if (!itemName || typeof itemName !== 'string') return null;
    const innerMatch = itemName.match(/\|\|(.+?)\|\|/);
    if (innerMatch) {
      const parts = innerMatch[1].split(';');
      return {
        cleanName: itemName.replace(/\|\|.*?\|\|/, '').trim(),
        city: parts[0] || null,
        lat: parts[1] && parts[1] !== 'null' ? Number(parts[1]) : null,
        lng: parts[2] && parts[2] !== 'null' ? Number(parts[2]) : null,
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
  }

  const applyJitter = (coord) => coord + (Math.random() - 0.5) * 0.01;

  const colorPalette = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];
  const getProductColor = (productName) => {
    // Busca no inventário
    const inInv = inventory.find(i => i.name.toLowerCase().trim() === productName.toLowerCase().trim());
    if (inInv && inInv.color) return inInv.color;

    let hash = 0;
    for (let i = 0; i < productName.length; i++) {
        hash = productName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colorPalette[Math.abs(hash) % colorPalette.length];
  };

  // --- MAPA ---
  useEffect(() => {
    const initMap = () => {
      if (!mapContainerRef.current || mapInstanceRef.current) return;
      if (!window.L) {
        // Leaflet ainda não carregou (script externo) — tenta novamente em 200ms
        setTimeout(initMap, 200);
        return;
      }
      mapInstanceRef.current = window.L.map(mapContainerRef.current, { zoomControl: false }).setView([-15.7801, -47.9292], 4);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(mapInstanceRef.current);

      // Força recálculo do tamanho após criação
      setTimeout(() => {
        if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize();
      }, 150);
    };

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;

    markersRef.current.forEach(m => mapInstanceRef.current.removeLayer(m));
    markersRef.current = [];

    filteredTransactions.forEach(t => {
      const loc = unpackLocation(t.itemName);
      if (loc && loc.lat && loc.lng && !isNaN(loc.lat) && !isNaN(loc.lng)) {
        const color = getProductColor(loc.cleanName);
        const finalLat = applyJitter(loc.lat);
        const finalLng = applyJitter(loc.lng);

        const marker = window.L.circleMarker([finalLat, finalLng], {
          radius: 8,
          fillColor: color,
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9,
          className: 'static-marker'
        }).addTo(mapInstanceRef.current)
          .bindPopup(`
            <div style="font-family: inherit;">
              <b style="font-size: 0.9rem;">${loc.cleanName}</b><br/>
              <span style="color: #64748b; font-size: 0.75rem;">👤 ${t.personName || 'Cliente'}</span><br/>
              <span style="font-size: 0.75rem;">📍 ${loc.city}</span>
            </div>
          `);
        markersRef.current.push(marker);
      }
    });

    if (markersRef.current.length > 0) {
      const group = new window.L.featureGroup(markersRef.current);
      mapInstanceRef.current.fitBounds(group.getBounds().pad(0.2));
    }
  }, [filteredTransactions]);

  return (
    <div className="bi-dashboard">
      {/* HEADER E FILTROS */}
      <div className="bi-header">
        <h1>📊 Sumário Executivo</h1>
        <div className="bi-filter-bar">
          <div className="bi-filter-group">
            <label>FILTRO DE PRODUTO</label>
            <select value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
              <option value="All">Todos os Produtos</option>
              {[...new Set(transactions.map(t => t.itemName.split('||')[0].trim()))].map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="bi-filter-group">
            <label>REGIÃO</label>
            <select value={selectedRegion} onChange={(e) => setSelectedRegion(e.target.value)}>
              <option value="All">Todas as Regiões</option>
              {[...new Set(transactions.map(t => unpackLocation(t.itemName)?.city || t.city))].filter(r => r).map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* SUMÁRIO GRID */}
      <div className="bi-summary-grid">
        <div className="bi-card">
          <span className="bi-card-label">Receita Total</span>
          <span className="bi-card-value">R$ {totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          <span className="bi-card-trend bi-trend-up">▲ 12.5% vs anterior</span>
        </div>
        <div className="bi-card">
          <span className="bi-card-label">Ticket Médio</span>
          <span className="bi-card-value">R$ {avgTicket.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          <span className="bi-card-trend bi-trend-up">▲ 4.2% vs anterior</span>
        </div>
        <div className="bi-card">
          <span className="bi-card-label">Vendas Realizadas</span>
          <span className="bi-card-value">{totalSales}</span>
          <span className="bi-card-trend">Estável</span>
        </div>
        <div className="bi-card">
          <span className="bi-card-label">Produtos Ativos</span>
          <span className="bi-card-value">{totalProducts}</span>
          <span className="bi-card-trend bi-trend-down">▼ 2 desligados</span>
        </div>
      </div>

      {/* CONTEÚDO PRINCIPAL: GRAFICO E MAPA */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div className="bi-card">
          <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem', color: '#475569' }}>Receita por Período</h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="receita" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bi-map-container">
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: '#475569' }}>Distribuição Geográfica</h3>
          <div ref={mapContainerRef} style={{ height: '350px', borderRadius: '8px', marginBottom: '1rem' }}></div>
          
          <table className="bi-data-table">
            <thead>
              <tr>
                <th>Região</th>
                <th>Vendas</th>
                <th>Receita</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {regionData.slice(0, 4).map((r, i) => (
                <tr key={i}>
                  <td>{r.region}</td>
                  <td>{r.vendas}</td>
                  <td>R$ {r.receita.toLocaleString('pt-BR')}</td>
                  <td><span className="bi-color-indicator" style={{ backgroundColor: '#3b82f6' }}></span> Ativo</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
