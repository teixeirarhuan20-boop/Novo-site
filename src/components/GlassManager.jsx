import React from 'react'
import { SimpleStockManager } from './SimpleStockManager'

export function GlassManager({ vidros, setVidros, addToast }) {
  return (
    <SimpleStockManager
      title="Vidros"
      subtitle="Controle de estoque de vidros por tipo e tamanho"
      icon="🪟"
      accentColor="#0891b2"
      tableName="vidros"
      items={vidros}
      setItems={setVidros}
      addToast={addToast}
    />
  )
}
