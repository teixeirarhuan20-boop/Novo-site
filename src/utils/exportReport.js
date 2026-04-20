/**
 * exportReport.js
 * Utilitário de exportação de relatório de estoque em TXT e PDF.
 * Sem dependências externas — usa apenas APIs nativas do navegador.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────
function nowBR() {
  const now = new Date()
  const date = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return { date, time, now }
}

function sortedByQty(items) {
  return [...items].sort((a, b) => Number(a.quantidade ?? a.quantity ?? 0) - Number(b.quantidade ?? b.quantity ?? 0))
}

function itemName(item) {
  return (item.nome || item.name || '').trim()
}

function itemQty(item) {
  return Number(item.quantidade ?? item.quantity ?? 0)
}

// ─── Exportar TXT ─────────────────────────────────────────────────────────────
export function exportTXT(items, title = 'Estoque') {
  const { date, time } = nowBR()
  const sorted = sortedByQty(items)

  const SEP = '─'.repeat(44)
  const lines = [
    `Relatório de Estoque — ${title}`,
    SEP,
    `Data: ${date}`,
    `Hora: ${time}`,
    SEP,
    '',
    ...sorted.map(item => `${itemName(item).padEnd(32, ' ')} ${itemQty(item)} un.`),
    '',
    SEP,
    `Total de itens: ${sorted.length}`,
    `Total de unidades: ${sorted.reduce((s, i) => s + itemQty(i), 0)}`,
    SEP,
  ]

  const content = lines.join('\n')
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  triggerDownload(blob, `relatorio-${slug(title)}-${date.replace(/\//g, '-')}.txt`)
}

// ─── Exportar PDF (via print do navegador) ────────────────────────────────────
export function exportPDF(items, title = 'Estoque') {
  const { date, time } = nowBR()
  const sorted = sortedByQty(items)

  const rows = sorted.map((item, i) => {
    const qty = itemQty(item)
    const qtyColor = qty === 0 ? '#dc2626' : qty < 10 ? '#d97706' : '#16a34a'
    const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc'
    return `
      <tr style="background:${bg}">
        <td style="padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a">${escHtml(itemName(item))}</td>
        <td style="padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:700;color:${qtyColor};text-align:center;width:90px">${qty}</td>
      </tr>`
  }).join('')

  const totalUnits = sorted.reduce((s, i) => s + itemQty(i), 0)

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Relatório de Estoque — ${escHtml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      color: #0f172a;
      background: #fff;
      padding: 36px 40px;
      max-width: 700px;
      margin: 0 auto;
    }

    /* ── Header ── */
    .header { margin-bottom: 28px }
    .header-title {
      font-size: 22px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
      margin-bottom: 6px;
    }
    .header-sub { font-size: 13px; color: #475569 }
    .header-sub span { font-weight: 600; color: #1e293b }
    .divider {
      border: none;
      border-top: 2px solid #e2e8f0;
      margin: 18px 0;
    }

    /* ── Tabela ── */
    table { width: 100%; border-collapse: collapse; margin-top: 4px }
    thead tr {
      background: #1e293b;
    }
    thead th {
      padding: 9px 14px;
      font-size: 11px;
      font-weight: 700;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      text-align: left;
    }
    thead th:last-child { text-align: center; width: 90px }

    /* ── Footer ── */
    .footer {
      margin-top: 24px;
      display: flex;
      justify-content: space-between;
      font-size: 11.5px;
      color: #64748b;
      border-top: 1px solid #e2e8f0;
      padding-top: 12px;
    }
    .footer-total { font-weight: 700; color: #0f172a }

    /* ── Botão impressão (some no print) ── */
    .print-bar {
      margin-bottom: 24px;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .btn-print {
      padding: 9px 22px;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      letter-spacing: 0.2px;
    }
    .btn-print:hover { background: #1d4ed8 }
    .btn-hint {
      font-size: 12px;
      color: #94a3b8;
    }

    /* ── Print styles ── */
    @media print {
      .print-bar { display: none !important }
      body { padding: 20px }
      @page {
        margin: 20mm 15mm;
        size: A4 portrait;
      }
    }
  </style>
</head>
<body>

  <div class="print-bar">
    <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    <span class="btn-hint">No diálogo de impressão, escolha "Salvar como PDF"</span>
  </div>

  <div class="header">
    <div class="header-title">📦 Relatório de Estoque</div>
    <div class="header-sub">
      <span>${escHtml(title)}</span>
      &nbsp;·&nbsp;
      Data: <span>${date}</span>
      &nbsp;·&nbsp;
      Hora: <span>${time}</span>
    </div>
  </div>

  <hr class="divider">

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th style="text-align:center">Qtd.</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="footer">
    <span>${sorted.length} item(s) listado(s)</span>
    <span class="footer-total">Total em estoque: ${totalUnits} un.</span>
  </div>

</body>
</html>`

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, '_blank', 'width=800,height=700')

  if (win) {
    win.addEventListener('load', () => {
      // Limpa a URL do blob após o conteúdo carregar
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    })
  } else {
    // Fallback: download como HTML se popup foi bloqueado
    triggerDownload(blob, `relatorio-${slug(title)}-${date.replace(/\//g, '-')}.html`)
    URL.revokeObjectURL(url)
  }
}

// ─── Helpers internos ─────────────────────────────────────────────────────────
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href    = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function slug(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function escHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
