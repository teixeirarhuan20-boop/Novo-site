import React from 'react';

export function LeadsManager({ leads, setLeads, sendToAna }) {

  const deleteLead = (id) => {
    setLeads(prevLeads => prevLeads.filter(lead => lead.id !== id));
  };

  const clearAllLeads = () => {
    if (window.confirm("Essa ação vai limpar todos os leads atuais da sua tabela! Continuar?")) {
      setLeads([]); 
    }
  };

  const safeLeads = leads.map((lead, index) => {
    return {
       ...lead,
       id: lead.id ? lead.id : `legacy_id_${index}_${Math.random()}`
    };
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>Leads Capturados pela IA</h1>
        {safeLeads.length > 0 && (
          <button onClick={clearAllLeads} className="delete-btn" style={{ fontWeight: 'bold' }}>
            Limpar Todos os Leads
          </button>
        )}
      </div>
      
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>E-mail</th>
            <th>Telefone</th>
            <th>Site / Outros</th>
            <th>Data</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {safeLeads.length === 0 ? (
            <tr>
              <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#8e8e8e' }}>
                Nenhum lead capturado ainda. Deixe seus clientes conversarem com a IA!
              </td>
            </tr>
          ) : (
            safeLeads.map((lead) => (
              <tr key={lead.id}>
                <td style={{ fontWeight: 500, color: '#10a37f' }}>{lead.nome || '-'}</td>
                <td>{lead.email || '-'}</td>
                <td>{lead.telefone || '-'}</td>
                <td>{lead.site || '-'}</td>
                <td style={{ fontSize: '0.85rem', color: '#888' }}>{lead.data || '-'}</td>
                <td>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => sendToAna(lead)} className="edit-btn" style={{ fontWeight: 'bold' }}>
                      🤖 Iniciar Abordagem
                    </button>
                    <button onClick={() => deleteLead(lead.id)} className="delete-btn">
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
