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
  { id: 'vidros',    icon: '🪟', label: 'Vidros' },
  { id: 'pecas',     icon: '🔧', label: 'Peças' },
  { id: 'pessoas',   icon: '👥', label: 'Pessoas / CRM' },
  { id: 'historico', icon: '📜', label: 'Histórico' },
  { section: 'PROSPECÇÃO' },
  { id: 'prospeccao', icon: '🔎', label: 'Prospecção de Leads' },
  { id: 'leads',      icon: '🎯', label: 'Leads Capturados' },
  { id: 'abordagem',  icon: '📣', label: 'Abordagem — Ana' },
  { section: 'SISTEMA' },
  { id: 'logs',      icon: '🚨', label: 'Log de Erros' },
]

export function Sidebar({ activeTab, onTabChange, isOpen, onClose }) {
  return (
    <>
      {/* Overlay escuro (só aparece no mobile quando menu está aberto) */}
      <div
        className={`sidebar-overlay ${isOpen ? 'open' : ''}`}
        onClick={onClose}
      />

      <nav className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Logo + botão fechar (mobile) */}
        <div className="sidebar-logo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>MEU NEGÓCIO <span>PRO</span></span>
          <button
            className="sidebar-close-btn"
            onClick={onClose}
            style={{
              display: 'none',           /* CSS mostra no mobile via .sidebar-close-btn */
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.25rem',
              cursor: 'pointer',
              padding: '0.2rem 0.4rem',
              lineHeight: 1,
              borderRadius: 'var(--radius-sm)',
              transition: 'color 0.15s',
            }}
            aria-label="Fechar menu"
          >
            ✕
          </button>
        </div>

        {/* Itens de navegação */}
        {NAV.map((item, i) => {
          if (item.section) {
            return (
              <div key={i} className="sidebar-section">{item.section}</div>
            )
          }
          return (
            <button
              key={item.id}
              className={`nav-btn ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => {
                onTabChange(item.id)
                onClose?.()   // fecha o drawer no mobile após navegar
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          )
        })}
      </nav>
    </>
  )
}
