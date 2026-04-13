import { analyzeOrderText } from './src/gemini.js';

const messyLabel = `
Endereço Completo:

Rua Pedro Bezerra Filho, 45, Bairro: Santos Reis, Parnamirim, Rio Grande do Norte, CEP: 59151-550

Produto:

Destino:

Parnamirim, Rio Grande do Norte

CEP:

59151-550

Pedido (Ref):

260409D81X686K

NF:

1765

Cliente:

MARIA ELENA ALVES DE ARAUJO



(Por favor, informe o produto deste item) Quantidade: 1 
`;

async function runTest() {
  console.log("Iniciando extração local...");
  try {
    const data = await analyzeOrderText(messyLabel);
    console.log("DADOS EXTRAÍDOS:");
    console.log(JSON.stringify(data, null, 2));
  } catch(e) {
    console.error("Erro na extração:", e);
  }
}

runTest();
