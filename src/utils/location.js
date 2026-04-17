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
      city:      city       || null,
      lat:       lat  && lat  !== 'null' ? Number(lat)  : null,
      lng:       lng  && lng  !== 'null' ? Number(lng)  : null,
      orderId:   orderId    || null,
      nf:        nf         || null,
      cep:       cep        || null,
      address:   address    || null,
      bairro:    bairro     || null,
      rastreio:  rastreio   || null,
      modalidade: modalidade || null,
    }
  }

  // Fallback legado [Cidade]
  const legacy = itemName.match(/\[(.*?)\]/)
  if (legacy) {
    return { cleanName: itemName.replace(/\[.*?\]/, '').trim(), city: legacy[1], lat: null, lng: null }
  }
  return null
}

// ─── Paleta com 30 cores maximamente distintas ─────────────────────────────
// Distribuídas ao longo do círculo cromático em intervalos de ~12°,
// alternando luminosidade para maximizar contraste entre vizinhos.
// Nenhuma cor repete; cada par adjacente tem diferença de hue ≥ 24°.
export const COLOR_PALETTE = [
  '#e63946', // vermelho vivo
  '#2196f3', // azul médio
  '#2ecc71', // verde esmeralda
  '#f39c12', // laranja dourado
  '#9b59b6', // roxo médio
  '#00bcd4', // ciano elétrico
  '#e91e63', // rosa choque
  '#1abc9c', // turquesa
  '#ff5722', // laranja-fogo
  '#3f51b5', // índigo
  '#8bc34a', // verde-lima
  '#c0392b', // vermelho escarlate
  '#0288d1', // azul céu
  '#f06292', // rosa suave
  '#00897b', // teal profundo
  '#7b1fa2', // violeta escuro
  '#ffb300', // âmbar brilhante
  '#5c6bc0', // azul-lilás
  '#388e3c', // verde floresta
  '#d81b60', // fúcsia
  '#0097a7', // ciano escuro
  '#e65100', // laranja queimado
  '#6a1b9a', // uva escuro
  '#43a047', // verde médio
  '#f4511e', // coral
  '#1565c0', // azul marinho
  '#558b2f', // oliva
  '#ad1457', // rosa escuro
  '#00695c', // verde-teal escuro
  '#6d4c41', // marrom cálido
]

// ─── Mapa de nomes legíveis (mesmo índice que COLOR_PALETTE) ───────────────
export const PALETTE_NAMES = [
  'Vermelho Vivo',   'Azul Médio',      'Verde Esmeralda', 'Laranja Dourado',
  'Roxo Médio',      'Ciano Elétrico',  'Rosa Choque',     'Turquesa',
  'Laranja Fogo',    'Índigo',          'Verde Lima',       'Vermelho Escarlate',
  'Azul Céu',        'Rosa Suave',      'Teal Profundo',   'Violeta Escuro',
  'Âmbar Brilhante', 'Azul Lilás',     'Verde Floresta',  'Fúcsia',
  'Ciano Escuro',    'Laranja Queimado','Uva Escuro',      'Verde Médio',
  'Coral',           'Azul Marinho',   'Oliva',            'Rosa Escuro',
  'Verde Teal',      'Marrom Cálido',
]

// ─── Próxima cor livre ──────────────────────────────────────────────────────
// Dado o array de cores já usadas, retorna a próxima cor da paleta não usada.
// Se todas estiverem ocupadas, reinicia do início (nunca retorna undefined).
export function nextFreeColor(usedColors = []) {
  const used = new Set(usedColors.map(c => (c || '').toLowerCase()))
  const free = COLOR_PALETTE.find(c => !used.has(c.toLowerCase()))
  return free ?? COLOR_PALETTE[0] // fallback se todas usadas
}

// ─── Cor do produto ─────────────────────────────────────────────────────────
// Lê inventory.color primeiro (fonte de verdade).
// Nunca usa hash — se não encontrar no inventário, retorna cinza neutro.
export function getProductColor(name, inventory = []) {
  const found = inventory.find(
    i => (i.name || '').toLowerCase().trim() === (name || '').toLowerCase().trim()
  )
  return found?.color || '#64748b'
}

// ─── Mapa nome→cor único ────────────────────────────────────────────────────
// Garante que cada produto receba uma cor diferente.
// Produtos com inventory.color definida usam essa cor.
// Demais recebem a próxima cor livre da paleta que não conflite com as existentes.
export function buildColorMap(productNames, inventory = []) {
  const map   = {}
  const taken = new Set(
    inventory.map(i => (i.color || '').toLowerCase()).filter(Boolean)
  )
  let idx = 0 // índice na paleta para produtos sem cor

  for (const name of productNames) {
    const inv = inventory.find(
      i => (i.name || '').toLowerCase().trim() === (name || '').toLowerCase().trim()
    )

    if (inv?.color) {
      map[name] = inv.color
    } else {
      // Avança na paleta até achar uma cor não tomada
      while (idx < COLOR_PALETTE.length && taken.has(COLOR_PALETTE[idx].toLowerCase())) idx++
      const color = COLOR_PALETTE[idx % COLOR_PALETTE.length]
      map[name] = color
      taken.add(color.toLowerCase())
      idx++
    }
  }
  return map
}

export function jitter(value, amount = 0.002) {
  return Number(value) + (Math.random() - 0.5) * amount
}
