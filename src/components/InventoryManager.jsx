import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

export function InventoryManager({ inventory, setInventory, transactions = [], setTransactions }) {
  const [form, setForm] = useState({ name: '', category: '', quantity: '', price: '', color: '#2563eb' });
  
  // Estado para controlar qual linha está sendo editada
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', category: '', quantity: '', price: '', color: '#2563eb' });

  const COLOR_OPTIONS = [
    { name: 'Azul Real', hex: '#2563eb' },
    { name: 'Verde Esmeralda', hex: '#16a34a' },
    { name: 'Laranja Vibrante', hex: '#d97706' },
    { name: 'Vermelho Fogo', hex: '#dc2626' },
    { name: 'Roxo Profundo', hex: '#7c3aed' },
    { name: 'Ciano Marinho', hex: '#0891b2' },
    { name: 'Rosa Choque', hex: '#db2777' },
    { name: 'Cinza Ardósia', hex: '#4b5563' },
    { name: 'Verde Floresta', hex: '#059669' },
    { name: 'Âmbar Sol', hex: '#b45309' },
    { name: 'Índigo Noturno', hex: '#4338ca' },
    { name: 'Lima Limão', hex: '#84cc16' },
    { name: 'Amarelo Ouro', hex: '#eab308' },
    { name: 'Violeta Suave', hex: '#a855f7' },
    { name: 'Fúcsia', hex: '#d946ef' },
    { name: 'Rosa Bebê', hex: '#f472b6' },
    { name: 'Céu Azul', hex: '#38bdf8' },
    { name: 'Menta Fresca', hex: '#2dd4bf' },
    { name: 'Oliva', hex: '#65a30d' },
    { name: 'Terracota', hex: '#c2410c' },
    { name: 'Vinho', hex: '#991b1b' },
    { name: 'Turquesa', hex: '#06b6d4' },
    { name: 'Bronze', hex: '#92400e' },
    { name: 'Lavanda', hex: '#818cf8' },
    { name: 'Pêssego', hex: '#fb923c' },
    { name: 'Esmeralda Escuro', hex: '#065f46' },
    { name: 'Marrom Café', hex: '#78350f' },
    { name: 'Slate', hex: '#1e293b' },
    { name: 'Coral', hex: '#f87171' },
    { name: 'Verde Musgo', hex: '#365314' }
  ];

  // Helper para encontrar cores ocupadas
  const usedColors = inventory.map(item => item.color).filter(Boolean);
  
  // Encontra a primeira cor disponível para o formulário de inclusão
  const getFirstAvailableColor = () => {
    const available = COLOR_OPTIONS.find(opt => !usedColors.includes(opt.hex));
    return available ? available.hex : COLOR_OPTIONS[0].hex;
  };

  // Estados para Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterQuantity, setFilterQuantity] = useState('all'); // 'all', 'in_stock', 'out_stock', 'low_stock'
  const [sortBy, setSortBy] = useState('name'); // 'name', 'quantity', 'price'

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  
  const handleEditChange = (e) => setEditForm({ ...editForm, [e.target.name]: e.target.value });

  // Helpers para salvar/carregar cores no localStorage (independente do Supabase)
  const saveColorToLocal = (id, color) => {
    try {
      const map = JSON.parse(localStorage.getItem('productColors') || '{}');
      map[id] = color;
      localStorage.setItem('productColors', JSON.stringify(map));
    } catch(e) {}
  };

  const loadColorsFromLocal = () => {
    try { return JSON.parse(localStorage.getItem('productColors') || '{}'); }
    catch(e) { return {}; }
  };

  const addItem = async (e) => {
    e.preventDefault();
    if (!form.name || !form.quantity || !form.price || !form.category) return;

    const chosenColor = form.color || '#2563eb';
    const newItem = {
      id: Date.now().toString() + Math.random().toString(),
      name: form.name,
      category: form.category,
      quantity: Number(form.quantity),
      price: Number(form.price),
      color: chosenColor
    };

    // Optimistic update
    setInventory(prev => [...prev, newItem]);
    setForm({ name: '', category: '', quantity: '', price: '', color: getFirstAvailableColor() });

    // Salva cor no localStorage (independente do Supabase)
    saveColorToLocal(newItem.id, chosenColor);

    // Salva no Supabase COM o campo color
    try {
      const { error: invError } = await supabase.from('inventory').insert([newItem]);
      if (invError) throw invError;

      // Registra movimentação inicial
      if (newItem.quantity > 0) {
        const newTransaction = {
          id: Date.now().toString() + Math.random().toString(),
          type: 'entrada',
          itemId: newItem.id,
          itemName: newItem.name,
          quantity: newItem.quantity,
          unitPrice: newItem.price,
          totalValue: newItem.price * newItem.quantity,
          personName: 'Sistema (Cadastro)',
          date: new Date().toLocaleDateString() + ' às ' + new Date().toLocaleTimeString()
        };
        setTransactions(prev => [...prev, newTransaction]);
        const { error: traError } = await supabase.from('transactions').insert([newTransaction]);
        if (traError) console.error('Erro ao salvar transação:', traError.message);
      }
    } catch (err) {
      console.error('ERRO ao salvar produto:', err);
      setInventory(prev => prev.filter(i => i.id !== newItem.id));
      alert('❌ Erro ao salvar: ' + err.message);
    }
  };

  const deleteItem = async (id) => {
    setInventory(prev => prev.filter(item => item.id !== id));
    
    // Delete from Supabase
    const { error } = await supabase.from('inventory').delete().eq('id', id);
    if (error) {
        // Error handling
    }
  };

  // Funções de Edição
  const startEditing = (item) => {
    setEditingId(item.id);
    setEditForm({ 
      name: item.name || '', 
      category: item.category || '', 
      quantity: item.quantity || 0, 
      price: item.price || 0,
      color: item.color || '#2563eb'
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const saveEdit = async (id) => {
    const chosenColor = editForm.color;
    const updatedItem = {
      name: editForm.name,
      category: editForm.category,
      quantity: Number(editForm.quantity),
      price: Number(editForm.price),
      color: chosenColor
    };

    setInventory(prev => prev.map(item => {
      if (String(item.id) === String(id)) {
        return { ...item, ...updatedItem };
      }
      return item;
    }));
    
    setEditingId(null);

    // Salva cor no localStorage (cache local)
    saveColorToLocal(id, chosenColor);

    // Atualiza Supabase COM o campo color
    const { error } = await supabase.from('inventory').update(updatedItem).eq('id', id);
    if (error) {
      console.error('Erro ao atualizar produto:', error.message);
    }
  };

  // Lógica da Curva ABCD
  const inFlowPerItem = {};
  const outFlowPerItem = {};
  const totalFlowPerItem = {};

  if (transactions && transactions.length > 0) {
    transactions.forEach(t => {
      if (t.type === 'entrada') {
        inFlowPerItem[t.itemId] = (inFlowPerItem[t.itemId] || 0) + Number(t.quantity);
      } else {
        outFlowPerItem[t.itemId] = (outFlowPerItem[t.itemId] || 0) + Number(t.quantity);
      }
      totalFlowPerItem[t.itemId] = (totalFlowPerItem[t.itemId] || 0) + Number(t.quantity);
    });
  }

  const flowArray = inventory.map(item => ({
    id: item.id,
    flow: totalFlowPerItem[item.id] || 0
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

  // Filtragem e Ordenação
  const categories = [...new Set(inventory.map(item => item.category))];

  const filteredInventory = inventory
    .filter(item => {
      const q = Number(item.quantity);
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase().trim());
      const matchesCategory = filterCategory === '' || item.category === filterCategory;
      
      let matchesQuantity = true;
      if (filterQuantity === 'in_stock') matchesQuantity = q > 0;
      else if (filterQuantity === 'out_stock') matchesQuantity = q === 0;
      else if (filterQuantity === 'low_stock') matchesQuantity = q > 0 && q < 5;
      
      return matchesSearch && matchesCategory && matchesQuantity;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'quantity') return b.quantity - a.quantity;
      if (sortBy === 'price') return b.price - a.price;
      return 0;
    });

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
        <div className="form-group">
          <label>Cor no Mapa</label>
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
            <select name="color" value={form.color} onChange={handleChange} style={{ flex: 1 }}>
             {COLOR_OPTIONS.filter(opt => !usedColors.includes(opt.hex)).map(opt => (
               <option key={opt.hex} value={opt.hex}>
                 {opt.name}
               </option>
             ))}
             {COLOR_OPTIONS.filter(opt => !usedColors.includes(opt.hex)).length === 0 && (
               <option value="">Sem cores disponíveis</option>
             )}
           </select>

            <div style={{ width: '25px', height: '25px', borderRadius: '50%', backgroundColor: form.color, border: '2px solid #fff', boxShadow: '0 0 0 1px #cbd5e1' }}></div>
          </div>
        </div>
        <button type="submit" className="primary-btn">Adicionar</button>
      </form>

      {/* Barra de Filtros */}
      <div className="filters-bar">
        <div className="filter-group" style={{ flex: 2 }}>
          <input 
            type="text" 
            placeholder="🔍 Pesquisar produto por nome..." 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)}
            className="filter-input"
          />
        </div>
        <div className="filter-group">
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="filter-select">
            <option value="">📂 Todas Categorias</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <select value={filterQuantity} onChange={(e) => setFilterQuantity(e.target.value)} className="filter-select">
            <option value="all">📦 Todos Níveis</option>
            <option value="in_stock">✅ Em Estoque</option>
            <option value="low_stock">⚠️ Estoque Baixo (&lt; 5)</option>
            <option value="out_stock">❌ Sem Estoque</option>
          </select>
        </div>
        <div className="filter-group">
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="filter-select">
            <option value="name">🔤 Nome (A-Z)</option>
            <option value="quantity">📊 Maior Estoque</option>
            <option value="price">💰 Maior Valor</option>
          </select>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Cor</th>
            <th>Produto</th>
            <th>Curva</th>
            <th>Categoria</th>
            <th>Em Estoque</th>
            <th>Valor Unitário</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {filteredInventory.length === 0 ? (
            <tr>
              <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#8e8e8e' }}>Nenhum produto encontrado com esses filtros.</td>
            </tr>
          ) : (
            filteredInventory.map((item) => (
              <tr key={item.id}>
                {String(editingId) === String(item.id) ? (
                  /* MODO DE EDIÇÃO (Inputs) */
                  <>
                    <td style={{ verticalAlign: 'middle' }}>
                       <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                         <select name="color" value={editForm.color} onChange={handleEditChange} style={{ padding: '2px', fontSize: '0.8rem' }}>
                           {COLOR_OPTIONS.filter(opt => opt.hex === item.color || !usedColors.includes(opt.hex)).map(opt => (
                             <option key={opt.hex} value={opt.hex}>
                               {opt.name} {opt.hex === item.color ? '(Atual)' : ''}
                             </option>
                           ))}
                         </select>
                         <div style={{ width: '100%', height: '4px', borderRadius: '2px', backgroundColor: editForm.color }}></div>
                       </div>
                    </td>
                    <td>
                      <input type="text" name="name" value={String(editForm.name || '')} onChange={handleEditChange} className="inline-input" />
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
                    <td style={{ verticalAlign: 'middle' }}>
                       <div style={{ width: '15px', height: '15px', borderRadius: '50%', backgroundColor: item.color || '#2563eb', margin: '0 auto', border: '1px solid #cbd5e1' }}></div>
                    </td>
                    <td style={{ fontWeight: 500 }}>{String(item.name || 'Sem Nome')}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
                        <span 
                          title={`Movimentação: ${inFlowPerItem[item.id] || 0} Entradas | ${outFlowPerItem[item.id] || 0} Saídas`} 
                          style={{
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
                    <td>{String(item.category || 'Geral')}</td>
                    <td>{Number(item.quantity || 0)}</td>
                    <td>R$ {Number(item.price || 0).toFixed(2)}</td>
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
