import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

export function InventoryManager({ inventory, setInventory, transactions = [] }) {
  const [form, setForm] = useState({ name: '', category: '', quantity: '', price: '' });
  
  // Estado para controlar qual linha está sendo editada
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', category: '', quantity: '', price: '' });

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  
  const handleEditChange = (e) => setEditForm({ ...editForm, [e.target.name]: e.target.value });

  const addItem = (e) => {
    e.preventDefault();
    if (!form.name || !form.quantity || !form.price || !form.category) return;
    
    const newItem = {
      id: Date.now().toString() + Math.random().toString(),
      name: form.name,
      category: form.category,
      quantity: Number(form.quantity),
      price: Number(form.price)
    };

    setInventory([...inventory, newItem]);
    setForm({ name: '', category: '', quantity: '', price: '' });
    
    // Save to Supabase
    supabase.from('inventory').insert([newItem]).then(({ error }) => {
      if (error) console.error('Erro ao salvar no Supabase:', error);
    });
  };

  const deleteItem = async (id) => {
    setInventory(inventory.filter(item => item.id !== id));
    
    // Delete from Supabase
    const { error } = await supabase.from('inventory').delete().eq('id', id);
    if (error) console.error('Erro ao deletar no Supabase:', error);
  };

  // Funções de Edição
  const startEditing = (item) => {
    setEditingId(item.id);
    setEditForm({ name: item.name, category: item.category, quantity: item.quantity, price: item.price });
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const saveEdit = async (id) => {
    const updatedItem = {
      name: editForm.name,
      category: editForm.category,
      quantity: Number(editForm.quantity),
      price: Number(editForm.price)
    };

    const updatedInventory = inventory.map(item => {
      if (item.id === id) {
        return { ...item, ...updatedItem };
      }
      return item;
    });
    
    setInventory(updatedInventory);
    setEditingId(null);

    // Update in Supabase
    const { error } = await supabase.from('inventory').update(updatedItem).eq('id', id);
    if (error) console.error('Erro ao atualizar no Supabase:', error);
  };

  // Lógica da Curva ABCD
  const flowPerItem = {};
  if (transactions && transactions.length > 0) {
    transactions.forEach(t => {
      if (!flowPerItem[t.itemId]) {
        flowPerItem[t.itemId] = 0;
      }
      // Soma tudo o que foi movimentado (Entrada + Saída)
      flowPerItem[t.itemId] += Number(t.quantity);
    });
  }

  const flowArray = inventory.map(item => ({
    id: item.id,
    flow: flowPerItem[item.id] || 0
  })).sort((a, b) => b.flow - a.flow);

  const itemCurves = {};
  // Conta apenas itens que têm fluxo maior que 0 para dividir os quartis
  const itemsWithFlow = flowArray.filter(i => i.flow > 0).length;

  flowArray.forEach((itemFlow, index) => {
    let curve = 'D'; 
    if (itemFlow.flow > 0) {
       const percentile = (index + 1) / (itemsWithFlow || 1);
       if (percentile <= 0.25) {
         curve = 'A';
       } else if (percentile <= 0.50) {
         curve = 'B';
       } else if (percentile <= 0.75) {
         curve = 'C';
       } else {
         curve = 'D';
       }
    }
    itemCurves[itemFlow.id] = curve;
  });

  const getCurveColor = (curve) => {
    switch(curve) {
      case 'A': return { bg: 'rgba(76, 175, 80, 0.2)', color: '#2b782e' }; // Verde (Alto fluxo)
      case 'B': return { bg: 'rgba(33, 150, 243, 0.2)', color: '#1367a8' }; // Azul (Médio-alto)
      case 'C': return { bg: 'rgba(255, 152, 0, 0.2)', color: '#b56d02' }; // Laranja (Médio-baixo)
      case 'D': return { bg: 'rgba(244, 67, 54, 0.2)', color: '#ad2218' }; // Vermelho (Baixo fluxo ou zero)
      default: return { bg: '#eee', color: '#666' };
    }
  };

  return (
    <div className="inventory-panel">
      <h1>Controle de Estoque</h1>
      
      <form className="add-form" onSubmit={addItem}>
        <div className="form-group">
          <label>Nome do Produto</label>
          <input type="text" name="name" value={form.name} onChange={handleChange} placeholder="Ex: Monitor Dell 24" required />
        </div>
        <div className="form-group">
          <label>Categoria</label>
          <input type="text" name="category" value={form.category} onChange={handleChange} placeholder="Ex: Eletrônicos" required />
        </div>
        <div className="form-group">
          <label>Qtde</label>
          <input type="number" name="quantity" value={form.quantity} onChange={handleChange} placeholder="0" required min="0" />
        </div>
        <div className="form-group">
          <label>Preço Unitário (R$)</label>
          <input type="number" name="price" value={form.price} onChange={handleChange} placeholder="0.00" step="0.01" required min="0" />
        </div>
        <button type="submit" className="primary-btn">Adicionar</button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Produto</th>
            <th>Curva</th>
            <th>Categoria</th>
            <th>Em Estoque</th>
            <th>Valor Unitário</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {inventory.length === 0 ? (
            <tr>
              <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#8e8e8e' }}>Nenhum produto cadastrado no estoque ainda.</td>
            </tr>
          ) : (
            inventory.map((item) => (
              <tr key={item.id}>
                {editingId === item.id ? (
                  /* MODO DE EDIÇÃO (Inputs) */
                  <>
                    <td>
                      <input type="text" name="name" value={editForm.name} onChange={handleEditChange} className="inline-input" />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                         <span style={{
                            padding: '0.2rem 0.6rem',
                            borderRadius: '12px',
                            fontSize: '0.85rem',
                            fontWeight: 'bold',
                            backgroundColor: getCurveColor(itemCurves[item.id]).bg,
                            color: getCurveColor(itemCurves[item.id]).color
                          }}>
                            {itemCurves[item.id] || 'D'}
                          </span>
                      </div>
                    </td>
                    <td>
                      <input type="text" name="category" value={editForm.category} onChange={handleEditChange} className="inline-input" />
                    </td>
                    <td>
                      <input type="number" name="quantity" value={editForm.quantity} onChange={handleEditChange} className="inline-input" style={{width: '70px'}} />
                    </td>
                    <td>
                      <input type="number" name="price" value={editForm.price} onChange={handleEditChange} className="inline-input" step="0.01" style={{width: '90px'}} />
                    </td>
                    <td style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => saveEdit(item.id)} className="save-btn">Salvar</button>
                      <button onClick={cancelEditing} className="cancel-btn">Cancelar</button>
                    </td>
                  </>
                ) : (
                  /* MODO DE LEITURA (Texto) */
                  <>
                    <td style={{ fontWeight: 500 }}>{item.name}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
                        <span title={`Fluxo total de movimentações: ${flowPerItem[item.id] || 0}`} style={{
                            padding: '0.2rem 0.6rem',
                            borderRadius: '12px',
                            fontSize: '0.85rem',
                            fontWeight: 'bold',
                            backgroundColor: getCurveColor(itemCurves[item.id]).bg,
                            color: getCurveColor(itemCurves[item.id]).color,
                            cursor: 'help'
                          }}>
                          {itemCurves[item.id] || 'D'}
                        </span>
                      </div>
                    </td>
                    <td>{item.category}</td>
                    <td>{item.quantity}</td>
                    <td>R$ {item.price.toFixed(2)}</td>
                    <td style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => startEditing(item)} className="edit-btn">
                        Editar
                      </button>
                      <button onClick={() => deleteItem(item.id)} className="delete-btn">
                        Excluir
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
