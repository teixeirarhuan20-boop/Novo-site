import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

export function HistoryManager({ transactions, setTransactions }) {
  
  const deleteTransaction = async (id) => {
    if (!window.confirm('Tem certeza que deseja excluir esta movimentação?')) return;
    setTransactions(prev => prev.filter(t => String(t.id) !== String(id)));
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) {
        // Error handling
    }
  };

  const clearHistory = async () => {
    if (!window.confirm('CUIDADO: Isso apagará TODO o histórico de movimentações permanentemente. Deseja continuar?')) return;
    setTransactions([]);
    const { error } = await supabase.from('transactions').delete().neq('id', 'temp_id_that_never_exists');
    if (error) {
        // Error handling
    }
    else alert('Histórico limpo com sucesso!');
  };

  if (!transactions) return <div className="inventory-panel">Carregando dados...</div>;

  return (
    <div className="inventory-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>Histórico e Mapa de Vendas</h1>
        {transactions.length > 0 && (
          <button onClick={clearHistory} className="delete-btn" style={{ padding: '0.6rem 1rem' }}>
            🗑️ Limpar Todo o Histórico
          </button>
        )}
      </div>

      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Tipo</th>
            <th>Produto</th>
            <th>Cidade</th>
            <th>Quantidade</th>
            <th>Valor</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {transactions.slice().reverse().length === 0 ? (
            <tr>
              <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: '#8e8e8e' }}>Nenhuma movimentação registrada.</td>
            </tr>
          ) : (
            <>
              {transactions.slice().reverse().map((t) => (
                <tr key={t.id}>
                  <td>{t.date && typeof t.date === 'string' ? t.date.split(',')[0] : 'Sem data'}</td>
                  <td>
                    <span style={{
                      padding: '0.2rem 0.6rem',
                      borderRadius: '12px',
                      fontSize: '0.8rem',
                      backgroundColor: t.type === 'entrada' ? 'rgba(76, 175, 80, 0.15)' : 'rgba(244, 67, 54, 0.15)',
                      color: t.type === 'entrada' ? '#4CAF50' : '#F44336',
                    }}>
                      {(t.type || 'SAÍDA').toUpperCase()}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{t.itemName || 'Produto sem nome'}</td>
                  <td>{t.city || '-'}</td>
                  <td>{t.quantity || 0} un.</td>
                  <td>R$ {Number(t.totalValue || 0).toFixed(2)}</td>
                  <td>
                     <button onClick={() => deleteTransaction(t.id)} className="delete-btn" style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}>
                        Excluir
                     </button>
                  </td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>

      {transactions.length > 0 && (
        <div style={{ 
          marginTop: '2rem', 
          padding: '1.5rem', 
          backgroundColor: '#1e293b', 
          borderRadius: '12px',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '1rem',
          border: '1px solid #334155'
        }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.3rem', textTransform: 'uppercase' }}>✅ Total Entradas</p>
            <h3 style={{ fontSize: '1.2rem', color: '#4CAF50' }}>
              {transactions.filter(t => t.type === 'entrada').reduce((acc, t) => acc + Number(t.quantity), 0)} un.
            </h3>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.3rem', textTransform: 'uppercase' }}>🛒 Total Saídas</p>
            <h3 style={{ fontSize: '1.2rem', color: '#F44336' }}>
              {transactions.filter(t => t.type === 'saída').reduce((acc, t) => acc + Number(t.quantity), 0)} un.
            </h3>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.3rem', textTransform: 'uppercase' }}>💰 Custo (Entradas)</p>
            <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>
              R$ {transactions.filter(t => t.type === 'entrada').reduce((acc, t) => acc + (Number(t.totalValue) || 0), 0).toFixed(2)}
            </h3>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '0.3rem', textTransform: 'uppercase' }}>📈 Receita (Vendas)</p>
            <h3 style={{ fontSize: '1.2rem', color: '#60a5fa' }}>
              R$ {transactions.filter(t => t.type === 'saída').reduce((acc, t) => acc + (Number(t.totalValue) || 0), 0).toFixed(2)}
            </h3>
          </div>
        </div>
      )}
    </div>
  );
}
