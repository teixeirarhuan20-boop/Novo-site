import React from 'react';

export function HistoryManager({ transactions }) {
  return (
    <div className="inventory-panel">
      <h1>Histórico de Movimentações</h1>

      <table>
        <thead>
          <tr>
            <th>Data e Hora</th>
            <th>Tipo</th>
            <th>Produto</th>
            <th>Quantidade</th>
            <th>Valor (Total)</th>
            <th>Pessoa Envolvida</th>
          </tr>
        </thead>
        <tbody>
          {transactions.slice().reverse().length === 0 ? (
            <tr>
              <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#8e8e8e' }}>Nenhuma movimentação registrada no histórico.</td>
            </tr>
          ) : (
            transactions.slice().reverse().map((t) => (
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
                <td>{t.quantity} un.</td>
                <td>
                  {t.totalValue !== undefined && t.totalValue !== null 
                    ? `R$ ${t.totalValue.toFixed(2)}` 
                    : '-'}
                </td>
                <td>{t.personName || '-'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
