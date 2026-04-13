export function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export function formatDate() {
  const now = new Date()
  return now.toLocaleDateString('pt-BR') + ' às ' + now.toLocaleTimeString('pt-BR')
}

export function normalizeText(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9)
}