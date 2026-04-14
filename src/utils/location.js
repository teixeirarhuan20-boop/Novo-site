// Geocodificação via Nominatim (OpenStreetMap)
export async function geocode(query) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=br&limit=1`,
      { headers: { 'User-Agent': 'MeuNegocioPro/2.0' } }
    )
    const data = await res.json()
    if (data?.length > 0) {
      return {
        lat: Number(data[0].lat),
        lng: Number(data[0].lon),
        displayName: data[0].display_name,
        city: data[0].display_name.split(',')[0].trim(),
      }
    }
  } catch {
    // silencioso
  }
  return null
}

// Empacota dados de localização na string do itemName
// Formato: "NomeProduto ||cidade;lat;lng;pedido;nf;cep;endereco;bairro;rastreio;modalidade||"
export function packLocation(productName, data = {}) {
  const { city = '', lat = null, lng = null, orderId = '', nf = '', cep = '', address = '', bairro = '', rastreio = '', modalidade = '' } = data
  return `${productName} ||${city};${lat};${lng};${orderId};${nf};${cep};${address};${bairro};${rastreio};${modalidade}||`
}

// Desempacota a string do itemName
export function unpackLocation(itemName) {
  if (!itemName || typeof itemName !== 'string') return null

  const match = itemName.match(/\|\|(.+?)\|\|/)
  if (match) {
    const [city, lat, lng, orderId, nf, cep, address, bairro, rastreio, modalidade] = match[1].split(';')
    return {
      cleanName: itemName.replace(/\|\|.*?\|\|/, '').trim(),
      city:      city      || null,
      lat:       lat && lat !== 'null'  ? Number(lat)  : null,
      lng:       lng && lng !== 'null'  ? Number(lng)  : null,
      orderId:   orderId   || null,
      nf:        nf        || null,
      cep:       cep       || null,
      address:   address   || null,
      bairro:    bairro    || null,
      rastreio:  rastreio  || null,
      modalidade: modalidade || null,
    }
  }

  // Fallback para formato legado [Cidade]
  const legacy = itemName.match(/\[(.*?)\]/)
  if (legacy) {
    return { cleanName: itemName.replace(/\[.*?\]/, '').trim(), city: legacy[1], lat: null, lng: null }
  }

  return null
}

// Paleta ampliada — 20 cores visualmente distintas (sem colisões até 20 produtos)
export const COLOR_PALETTE = [
  '#2563eb', // azul
  '#16a34a', // verde
  '#dc2626', // vermelho
  '#d97706', // âmbar
  '#7c3aed', // violeta
  '#0891b2', // ciano
  '#db2777', // rosa
  '#ea580c', // laranja
  '#0f766e', // teal
  '#4338ca', // índigo
  '#65a30d', // lima
  '#9333ea', // roxo
  '#0284c7', // azul-céu
  '#b45309', // marrom-âmbar
  '#be185d', // rosa-escuro
  '#059669', // esmeralda
  '#c2410c', // laranja-escuro
  '#1d4ed8', // azul-escuro
  '#15803d', // verde-escuro
  '#6d28d9', // violeta-escuro
]

// Retorna a cor do produto pelo inventário (campo color) ou pelo índice na paleta
// Prefira buildColorMap para garantir cores únicas por produto no mapa
export function getProductColor(name, inventory = []) {
  const found = inventory.find(i =>
    (i.name || '').toLowerCase().trim() === (name || '').toLowerCase().trim()
  )
  if (found?.color) return found.color

  // fallback por hash (usado fora do mapa onde não há lista de produtos)
  let hash = 0
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length]
}

// Constrói mapa nome→cor garantindo cor ÚNICA por produto (sem colisões)
// productNames deve ser a lista ORDENADA de produtos a exibir
export function buildColorMap(productNames, inventory = []) {
  const map = {}
  let paletteIdx = 0
  for (const name of productNames) {
    const inv = inventory.find(i =>
      (i.name || '').toLowerCase().trim() === (name || '').toLowerCase().trim()
    )
    // Usa cor do inventário se existir, senão pega próxima cor da paleta
    map[name] = inv?.color || COLOR_PALETTE[paletteIdx % COLOR_PALETTE.length]
    if (!inv?.color) paletteIdx++
  }
  return map
}

export function jitter(value, amount = 0.002) {
  return Number(value) + (Math.random() - 0.5) * amount
}