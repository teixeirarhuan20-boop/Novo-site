import React, { useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';

export function PeopleManager({ pessoas, setPessoas, transactions = [] }) {
  const [form, setForm] = useState({ name: '', document: '', role: 'cliente', contact: '', email: '', address: '', cep: '', city: '' });
  const [search, setSearch] = useState('');

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const addPerson = async (e) => {
    e.preventDefault();
    if (!form.name) return;

    const newPerson = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      ...form,
      created_at: new Date().toISOString(),
      source: 'Cadastro manual'
    };

    setPessoas(prev => [...prev, newPerson]);
    setForm({ name: '', document: '', role: 'cliente', contact: '', email: '', address: '', cep: '', city: '' });

    const { error } = await supabase.from('pessoas').insert([newPerson]);
    if (error) {
        // Error handling
    }
  };

  const deletePerson = async (id) => {
    setPessoas(prev => prev.filter(p => p.id !== id));
    const { error } = await supabase.from('pessoas').delete().eq('id', id);
    if (error) {
        // Error handling
    }
  };

  // --- CÁLCULO DE TOTAIS POR CLIENTE ---
  const clientStats = useMemo(() => {
    const stats = {};
    transactions.forEach(t => {
      const personName = t.personName || '';
      if (!personName) return;
      if (!stats[personName]) {
        stats[personName] = { totalValue: 0, orderCount: 0 };
      }
      stats[personName].totalValue += Number(t.totalValue) || 0;
      stats[personName].orderCount += 1;
    });
    return stats;
  }, [transactions]);

  // --- CURVA ABC ---
  // Classifica clientes por receita acumulada: A=80%, B=15%, C=5%
  const enrichedPessoas = useMemo(() => {
    const withStats = pessoas.map(p => ({
      ...p,
      totalValue: clientStats[p.name]?.totalValue || 0,
      orderCount: clientStats[p.name]?.orderCount || 0,
    }));

    // Ordena por receita decrescente
    const sorted = [...withStats].sort((a, b) => b.totalValue - a.totalValue);
    const totalRevenue = sorted.reduce((acc, p) => acc + p.totalValue, 0);

    let cumulative = 0;
    return sorted.map(p => {
      cumulative += p.totalValue;
      const pct = totalRevenue > 0 ? (cumulative / totalRevenue) : 1;
      let curve = 'C';
      if (pct <= 0.80) curve = 'A';
      else if (pct <= 0.95) curve = 'B';
      return { ...p, curve };
    });
  }, [pessoas, clientStats]);

  const curveMeta = {
    A: { label: 'A', bg: '#fef3c7', color: '#92400e', border: '#f59e0b', title: 'Cliente Ouro — Prioridade Máxima' },
    B: { label: 'B', bg: '#e0f2fe', color: '#0c4a6e', border: '#0ea5e9', title: 'Cliente Prata — Potencial de Crescimento' },
    C: { label: 'C', bg: '#f1f5f9', color: '#475569', border: '#94a3b8', title: 'Cliente Bronze — Fidelização Necessária' },
  };

  const filtered = enrichedPessoas.filter(p =>
    (p.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.city || '').toLowerCase().includes(search.toLowerCase())
  );

  // Resumo ABC
  const abcSummary = ['A', 'B', 'C'].map(curve => {
    const group = enrichedPessoas.filter(p => p.curve === curve);
    return {
      curve,
      count: group.length,
      revenue: group.reduce((acc, p) => acc + p.totalValue, 0),
    };
  });

  return (
    <div className="inventory-panel">
      <div className="bi-header">
        <div>
          <h1>👥 CRM de Clientes</h1>
          <p>Gestão completa com histórico de compras e Curva ABC automática.</p>
        </div>
      </div>

      {/* RESUMO CURVA ABC */}
      <div className="bi-summary-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '2rem' }}>
        {abcSummary.map(({ curve, count, revenue }) => (
          <div key={curve} className="bi-card" style={{ borderLeft: `4px solid ${curveMeta[curve].border}` }}>
            <span className="bi-card-label">Curva {curve} — {curve === 'A' ? 'Ouro ⭐' : curve === 'B' ? 'Prata 🥈' : 'Bronze 🥉'}</span>
            <span className="bi-card-value">{count} clientes</span>
            <span className="bi-card-trend" style={{ color: curveMeta[curve].color }}>
              R$ {revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        ))}
      </div>

      {/* FORMULÁRIO DE CADASTRO */}
      <div className="bi-card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: '#1e293b' }}>+ Cadastrar Nova Pessoa</h3>
        <form onSubmit={addPerson}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Nome / Razão Social *</label>
              <input type="text" name="name" value={form.name} onChange={handleChange} placeholder="Nome completo" required />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>CPF / CNPJ</label>
              <input type="text" name="document" value={form.document} onChange={handleChange} placeholder="Opcional" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Tipo</label>
              <select name="role" value={form.role} onChange={handleChange} className="inline-input">
                <option value="cliente">Cliente</option>
                <option value="fornecedor">Fornecedor</option>
                <option value="ambos">Ambos</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Telefone</label>
              <input type="text" name="contact" value={form.contact} onChange={handleChange} placeholder="(11) 9..." />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>E-mail</label>
              <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="email@..." />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>CEP</label>
              <input type="text" name="cep" value={form.cep} onChange={handleChange} placeholder="00000-000" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Cidade</label>
              <input type="text" name="city" value={form.city} onChange={handleChange} placeholder="São Paulo" />
            </div>
          </div>
          <div className="form-group" style={{ margin: '0 0 1rem' }}>
            <label>Endereço Completo</label>
            <input type="text" name="address" value={form.address} onChange={handleChange} placeholder="Rua, Número, Bairro" />
          </div>
          <button type="submit" className="action-btn">Cadastrar Pessoa</button>
        </form>
      </div>

      {/* LISTA */}
      <div className="bi-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ color: '#1e293b' }}>Lista de Clientes ({enrichedPessoas.length})</h3>
          <input
            type="text"
            placeholder="🔍 Buscar por nome ou cidade..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '0.5rem 0.8rem', borderRadius: '8px', border: '1px solid #e2e8f0', width: '280px', fontSize: '0.9rem' }}
          />
        </div>
        <table className="bi-data-table">
          <thead>
            <tr>
              <th>Curva</th>
              <th>Nome</th>
              <th>Cidade / CEP</th>
              <th>Contato</th>
              <th>Pedidos</th>
              <th>Total Gasto</th>
              <th>Fonte</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                  Nenhum cliente encontrado.
                </td>
              </tr>
            ) : (
              filtered.map(p => {
                const meta = curveMeta[p.curve];
                return (
                  <tr key={p.id}>
                    <td>
                      <span
                        title={meta.title}
                        style={{
                          display: 'inline-block',
                          padding: '2px 10px',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          background: meta.bg,
                          color: meta.color,
                          border: `1px solid ${meta.border}`,
                          cursor: 'help'
                        }}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td style={{ color: '#64748b', fontSize: '0.85rem' }}>
                      {p.city || '-'}
                      {p.cep && <><br /><span style={{ fontSize: '0.75rem' }}>{p.cep}</span></>}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>
                      {p.contact || p.email || '-'}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                      {p.orderCount > 0 ? (
                        <span style={{ color: '#2563eb' }}>{p.orderCount}x</span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>0</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 'bold', color: p.totalValue > 0 ? '#16a34a' : '#94a3b8' }}>
                      R$ {p.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      {p.source === 'Criado automaticamente via etiqueta' ? '🤖 IA' : p.source || '✍️ Manual'}
                    </td>
                    <td>
                      <button onClick={() => deletePerson(p.id)} className="delete-btn">Excluir</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
