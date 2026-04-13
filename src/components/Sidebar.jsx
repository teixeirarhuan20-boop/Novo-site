import React from 'react'

const NAV = [
  { section: 'ANÁLISE' },
  { id: 'dashboard', icon: '📊', label: 'Dashboard' },
  { id: 'mapa',      icon: '🗺️', label: 'Mapa de Vendas' },
  { section: 'OPERAÇÃO' },
  { id: 'pedidos',   icon: '🛒', label: 'Pedidos' },
  { id: 'qrcodes',   icon: '🏷️', label: 'QR Codes' },
  { id: 'entrada',   icon: '🔁', label: 'Movimentações' },
  { section: 'GESTÃO' },
  { id: 'estoque',   icon: '📦', label: 'Estoque' },
  { id: 'pessoas',   icon: '👥', label: 'Pessoas / CRM' },
  { id: 'historico', icon: '📜', label: 'Histórico' },
  { section: 'SISTEMA' },
  { id: 'logs',      icon: '🚨', label: 'Log de Erros' },
]

export function Sidebar({ activeTab, onTabChange }) {
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        MEU NEGÓCIO <span>PRO</span>
      </div>

      {NAV.map((item, i) => {
        if (item.section) {
          return <div key={i} className="sidebar-section">{item.section}</div>
        }
        return (
          <button
            key={item.id}
            className={`nav-btn ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => onTabChange(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}
