import React from 'react'
import { SimpleStockManager } from './SimpleStockManager'

export function PartsManager({ pecas, setPecas, addToast }) {
  return (
    <SimpleStockManager
      title="Peças"
      subtitle="Controle de estoque de peças por tipo e especificação"
      icon="🔧"
      accentColor="#7c3aed"
      tableName="pecas"
      items={pecas}
      setItems={setPecas}
      addToast={addToast}
    />
  )
}
