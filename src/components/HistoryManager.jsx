import React from 'react';
import { supabase } from '../lib/supabase';

export function HistoryManager({ transactions, setTransactions }) {
  
  const deleteTransaction = async (id) => {
    if (!window.confirm('Tem certeza que deseja excluir esta movimentação?')) return;

    // Atualiza localmente
    setTransactions(prev => prev.filter(t => String(t.id) !== String(id)));

    // Deleta no Supabase
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) console.error('Erro ao deletar transação:', error);
  };

  const clearHistory = async () => {
    if (!window.confirm('CUIDADO: Isso apagará TODO o histórico de movimentações permanentemente. Deseja continuar?')) return;

    // Atualiza localmente
    setTransactions([]);

    // Deleta tudo no Supabase onde o id é diferente de zero (fallback para deletar tudo)
    const { error } = await supabase.from('transactions').delete().neq('id', 'temp_id_that_never_exists');
    if (error) console.error('Erro ao limpar histórico:', error);
    else alert('Histórico limpo com sucesso!');
  };

  return (
    <div className="inventory-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1>Histórico de Movimentações</h1>
        {transactions.length > 0 && (
          <button onClick={clearHistory} className="delete-btn" style={{ padding: '0.6rem 1rem' }}>
            🗑️ Limpar Todo o Histórico
          </button>
        )}
      </div>

      <table>
        <thead>
          <tr>
            <th>Data e Hora</th>
            <th>Tipo</th>
            <th>Produto</th>
            <th>Unitário</th>
            <th>Quantidade</th>
            <th>Valor (Total)</th>
            <th>Pessoa Envolvida</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {transactions.slice().reverse().length === 0 ? (
            <tr>
              <td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: '#8e8e8e' }}>Nenhuma movimentação registrada no histórico.</td>
            </tr>
          ) : (
            <>
              {transactions.slice().reverse().map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>
                    <span style={{
                      padding: '0.2rem 0.6rem',
                      borderRadius: '12px',
                      fontSize: '0.85rem',
                      backgroundColor: t.type === 'entrada' ? 'rgba(76, 175, 80, 0.15)' : 'rgba(244, 67, 54, 0.15)',
                      color: t.type === 'entrada' ? '#4CAF50' : '#F44336',
                      fontWeight: 500
                    }}>
                      {t.type === 'entrada' ? 'ENTRADA' : 'SAÍDA'}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{t.itemName}</td>
                  <td>
                    {t.unitPrice !== undefined && t.unitPrice !== null 
                      ? `R$ ${Number(t.unitPrice).toFixed(2)}` 
                      : '-'}
                  </td>
                  <td>{t.quantity} un.</td>
                  <td>
                    {t.totalValue !== undefined && t.totalValue !== null 
                      ? `R$ ${Number(t.totalValue).toFixed(2)}` 
                      : '-'}
                  </td>
                  <td>{t.personName || '-'}</td>
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

      {/* Resumo de Totais no Final */}
      {transactions.length > 0 && (
        <div style={{ 
          marginTop: '2rem', 
          padding: '1.5rem', 
          backgroundColor: 'var(--bot-msg-bg)', 
          borderRadius: '12px',
          display: 'flex',
          justifyContent: 'space-around',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#8e8e8e', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Total Movimentado</p>
            <h3 style={{ fontSize: '1.5rem', color: '#fff' }}>
              {transactions.reduce((acc, t) => acc + Number(t.quantity), 0)} unidades
            </h3>
          </div>
          <div style={{ textAlign: 'center', width: '1px', backgroundColor: 'var(--border-color)' }}></div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#8e8e8e', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Valor Financeiro Bruto</p>
            <h3 style={{ fontSize: '1.5rem', color: '#4CAF50' }}>
              R$ {transactions.reduce((acc, t) => acc + (Number(t.totalValue) || 0), 0).toFixed(2)}
            </h3>
          </div>
        </div>
      )}
    </div>
  );
}
