import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export function ProductLocationInsights({ transactions = [], inventory = [] }) {
  const [selectedProductId, setSelectedProductId] = useState('all');

  // Helper para extrair cidade da "Smart String" (formato: Nome ||Cidade;Lat;Lng...||)
  const unpackCity = (itemName) => {
    if (!itemName || typeof itemName !== 'string') return 'Desconhecido';
    const m = itemName.match(/\s*\|\|\s*(.*?)\s*\|\|\s*/);
    if (m) {
      const parts = m[1].split(';').map(p => p.trim());
      return parts[0] || 'Desconhecido';
    }
    return 'Desconhecido';
  };

  const insights = useMemo(() => {
    // Filtra apenas saídas (vendas)
    const sales = transactions.filter(t => t.type === 'saída');
    const locationStats = {};

    sales.forEach(t => {
      // Filtra por produto se não for "Todos"
      if (selectedProductId !== 'all' && String(t.itemId) !== String(selectedProductId)) return;

      const city = unpackCity(t.itemName);
      
      if (!locationStats[city]) {
        locationStats[city] = { city, count: 0, revenue: 0 };
      }
      
      locationStats[city].count += Number(t.quantity || 0);
      locationStats[city].revenue += Number(t.totalValue || 0);
    });

    // Ordena pelas cidades que mais compraram (quantidade) e pega o Top 5
    return Object.values(locationStats)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [transactions, selectedProductId]);

  return (
    <div className="bi-card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#1e293b' }}>📍 Top Localidades por Produto</h3>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Cidades que geram mais volume de pedidos</p>
        </div>
        <select 
          value={selectedProductId} 
          onChange={(e) => setSelectedProductId(e.target.value)}
          style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', outline: 'none' }}
        >
          <option value="all">Todos os Produtos</option>
          {inventory.map(item => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>

      {/* Visualização em Gráfico */}
      {insights.length > 0 && (
        <div style={{ height: '220px', marginBottom: '1.5rem', paddingRight: '1rem' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={insights}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
              <XAxis type="number" hide />
              <YAxis
                dataKey="city"
                type="category"
                tick={{ fontSize: 12, fill: '#475569', fontWeight: 500 }}
                axisLine={false}
                tickLine={false}
                width={100}
              />
              <Tooltip
                cursor={{ fill: '#f1f5f9' }}
                formatter={(value) => [`${value} un.`, 'Vendas']}
                contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
              />
              <Bar 
                dataKey="count" 
                fill="#3b82f6" 
                radius={[0, 4, 4, 0]} 
                barSize={18} 
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <table className="bi-data-table">
        <thead>
          <tr>
            <th>Cidade / Região</th>
            <th style={{ textAlign: 'center' }}>Qtd Vendida</th>
            <th style={{ textAlign: 'right' }}>Receita Gerada</th>
          </tr>
        </thead>
        <tbody>
          {insights.map((item, idx) => (
            <tr key={idx}>
              <td style={{ fontWeight: '600' }}>{item.city}</td>
              <td style={{ textAlign: 'center' }}>{item.count} un.</td>
              <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 'bold' }}>
                R$ {item.revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </td>
            </tr>
          ))}
          {insights.length === 0 && (
            <tr>
              <td colSpan="3" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                Nenhuma venda registrada para os critérios selecionados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}