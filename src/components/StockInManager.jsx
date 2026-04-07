import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

export function StockInManager({ inventory, setInventory, pessoas, transactions, setTransactions }) {
  // Estado local para armazenar a quantidade e pessoa selecionada para cada item da lista
  const [actions, setActions] = useState({});

  // Estados para Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  const handleActionChange = (itemId, field, value) => {
    setActions(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value
      }
    }));
  };

  const handleTransaction = (item, type) => {
    const itemAction = actions[item.id] || {};
    const quantity = Number(itemAction.quantity || 0);
    const pessoaId = itemAction.pessoaId || '';

    if (quantity <= 0) return;

    if (type === 'saida' && quantity > item.quantity) {
      alert(`Erro: Quantidade de saída (${quantity}) maior que o saldo em estoque (${item.quantity}).`);
      return;
    }

    const pessoa = pessoas.find(p => p.id === pessoaId);

    // Atualiza estoque
    const newQuantity = type === 'entrada' ? item.quantity + quantity : item.quantity - quantity;
    setInventory(prev => prev.map(i => {
      if (i.id === item.id) {
        return { ...i, quantity: newQuantity };
      }
      return i;
    }));

    // Registra transação
    const newTransaction = {
      id: Date.now().toString() + Math.random().toString(),
      type: type,
      itemId: item.id,
      itemName: item.name,
      quantity: quantity,
      unitPrice: item.price,
      totalValue: item.price * quantity,
      personName: pessoa ? pessoa.name : '',
      date: new Date().toLocaleDateString() + ' às ' + new Date().toLocaleTimeString()
    };
    setTransactions(prev => [...prev, newTransaction]);

    // Save to Supabase (Atomic updates)
    async function syncToSupabase() {
      const { error: invError } = await supabase.from('inventory').update({ quantity: newQuantity }).eq('id', item.id);
      const { error: traError } = await supabase.from('transactions').insert([newTransaction]);
      
      if (invError || traError) {
        console.error('Erro ao sincronizar com Supabase:', invError || traError);
      }
    }
    syncToSupabase();

    // Limpa os campos daquele item
    setActions(prev => ({
      ...prev,
      [item.id]: { quantity: '', pessoaId: '' }
    }));
    
    // Feedback visual opcional
    alert(`Sucesso! ${type === 'entrada' ? 'Entrada' : 'Saída'} de ${quantity} un. de ${item.name} registrada.`);
  };

  return (
    <div className="inventory-panel">
      <h1>Entradas e Saídas Rápidas</h1>
      <p style={{marginBottom: '1rem', color: '#8e8e8e'}}>
        Abaixo estão todos os produtos cadastrados. Você pode adicionar (entrada) ou remover (saída) quantidades rapidamente.
      </p>

      {/* Barra de Filtros */}
      <div className="filters-bar" style={{ marginBottom: '1.5rem' }}>
        <div className="filter-group" style={{ flex: 1 }}>
          <input 
            type="text" 
            placeholder="🔍 Encontrar produto pelo nome..." 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)}
            className="filter-input"
          />
        </div>
        <div className="filter-group" style={{ width: '250px' }}>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="filter-select">
            <option value="">📂 Todas Categorias</option>
            {[...new Set(inventory.map(item => item.category))].map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Produto</th>
            <th>Estoque Atual</th>
            <th>Quantidade</th>
            <th>Pessoa (Opcional)</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody>
          {inventory
            .filter(item => {
              const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
              const matchesCategory = filterCategory === '' || item.category === filterCategory;
              return matchesSearch && matchesCategory;
            })
            .length === 0 ? (
            <tr>
              <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: '#8e8e8e' }}>Nenhum produto encontrado.</td>
            </tr>
          ) : (
            inventory
              .filter(item => {
                const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
                const matchesCategory = filterCategory === '' || item.category === filterCategory;
                return matchesSearch && matchesCategory;
              })
              .map((item) => {
              const itemAction = actions[item.id] || { quantity: '', pessoaId: '' };
              return (
                <tr key={item.id}>
                  <td style={{ fontWeight: 500 }}>{item.name}</td>
                  <td>
                    <span style={{
                      backgroundColor: item.quantity > 0 ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)',
                      color: item.quantity > 0 ? '#4CAF50' : '#F44336',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '12px',
                      fontWeight: 'bold'
                    }}>
                      {item.quantity} un.
                    </span>
                  </td>
                  <td>
                    <input 
                      type="number" 
                      value={itemAction.quantity} 
                      onChange={(e) => handleActionChange(item.id, 'quantity', e.target.value)} 
                      placeholder="Qtd." 
                      min="1"
                      className="inline-input"
                      style={{ width: '80px', margin: 0 }}
                    />
                  </td>
                  <td>
                    <select 
                      value={itemAction.pessoaId} 
                      onChange={(e) => handleActionChange(item.id, 'pessoaId', e.target.value)}
                      className="inline-input"
                      style={{ margin: 0, width: '150px' }}
                    >
                      <option value="">-- Ninguém --</option>
                      {pessoas.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button 
                        onClick={() => handleTransaction(item, 'entrada')} 
                        className="save-btn" 
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                      >
                         + Entrada
                      </button>
                      <button 
                        onClick={() => handleTransaction(item, 'saida')} 
                        className="delete-btn" 
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                      >
                         - Saída
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
