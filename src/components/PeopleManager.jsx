import React, { useState } from 'react';

export function PeopleManager({ pessoas, setPessoas }) {
  const [form, setForm] = useState({ name: '', document: '', role: 'fornecedor', contact: '' });

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const addPerson = (e) => {
    e.preventDefault();
    if (!form.name) return;
    
    const newPerson = {
      id: Date.now().toString() + Math.random().toString(),
      ...form
    };

    setPessoas([...pessoas, newPerson]);
    setForm({ name: '', document: '', role: 'fornecedor', contact: '' });
  };

  const deletePerson = (id) => {
    setPessoas(pessoas.filter(p => p.id !== id));
  };

  return (
    <div className="inventory-panel">
      <h1>Cadastro de Pessoas</h1>
      
      <form className="add-form" onSubmit={addPerson}>
        <div className="form-group">
          <label>Nome / Razão Social</label>
          <input type="text" name="name" value={form.name} onChange={handleChange} placeholder="Ex: Fornecedora XYZ" required />
        </div>
        <div className="form-group">
          <label>CPF / CNPJ</label>
          <input type="text" name="document" value={form.document} onChange={handleChange} placeholder="Opcional" />
        </div>
        <div className="form-group">
          <label>Tipo</label>
          <select name="role" value={form.role} onChange={handleChange} className="inline-input">
            <option value="fornecedor">Fornecedor</option>
            <option value="cliente">Cliente</option>
            <option value="ambos">Ambos</option>
          </select>
        </div>
        <div className="form-group">
          <label>Contato (Telefone/Email)</label>
          <input type="text" name="contact" value={form.contact} onChange={handleChange} placeholder="Opcional" />
        </div>
        <button type="submit" className="primary-btn">Cadastrar</button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Documento</th>
            <th>Tipo</th>
            <th>Contato</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {pessoas.length === 0 ? (
            <tr>
              <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: '#8e8e8e' }}>Nenhuma pessoa cadastrada.</td>
            </tr>
          ) : (
            pessoas.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td>{p.document || '-'}</td>
                <td style={{ textTransform: 'capitalize' }}>{p.role}</td>
                <td>{p.contact || '-'}</td>
                <td>
                  <button onClick={() => deletePerson(p.id)} className="delete-btn">
                    Excluir
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
