import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const tools = [
  { googleSearch: {} }
];

const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", tools });

export async function sendMessageToGemini(history, message, inventory, onLeadCaptured) {
  try {
    let cleanHistory = history;
    if (cleanHistory.length > 0 && cleanHistory[0].role === 'bot') {
      cleanHistory = cleanHistory.slice(1);
    }

    const chat = model.startChat({
      history: cleanHistory.map(msg => ({
        role: msg.role === 'bot' ? 'model' : 'user',
        parts: [{ text: msg.text }],
      })),
      generationConfig: {
        maxOutputTokens: 2000,
        temperature: 0.2, // Reduzi a temperatura para focar nela obedecendo o JSON estritamente
      },
    });

    const inventoryContext = JSON.stringify(inventory.map(i => ({Produto: i.name, Categoria: i.category, Qtde: i.quantity, Preco: i.price})));
    
    // Instruímos firmemente como exportar a lista!
    const enrichedMessage = `[SISTEMA INTERNO: ESTOQUE\n${inventoryContext}]\n
    Você é a assistente comercial.
    Comando: O usuário vai pedir lojas/leads. Você busca no Google.
    
    REGRA CRÍTICA DE COMUNICAÇÃO DE DADOS: O sistema web NÃO recebe a lista se você não escrever em JSON. Se você encontrar empresas no Google, OBRIGATORIAMENTE escreva a lista final dentro de um bloco de código json com chave de array []. 
    Exemplo estrito:
    \`\`\`json
    [
      { "nome": "Empresa XY", "email": "contato@site", "telefone": "1199", "site": "site.com" }
    ]
    \`\`\`
    Insira isso no meio da sua resposta!
    
    \nUsuário: ${message}`;

    const result = await chat.sendMessage(enrichedMessage);
    let originalText = result.response.text();
    console.log("RESPOSTA CRUA DO GEMINI: ", originalText);
    
    let leadEncontradoAqui = false;

    // 1. Tenta Extração Padrão (com ou sem a palavra 'json' na tag)
    try {
      const jsonRegex = /```(?:json)?\s*(\[[\s\S]*?\])\s*```/gi;
      let match;
      while ((match = jsonRegex.exec(originalText)) !== null) {
         const extractedData = JSON.parse(match[1]);
         if (Array.isArray(extractedData)) {
            extractedData.forEach(l => onLeadCaptured(l));
            leadEncontradoAqui = true;
         }
      }
    } catch(e) {
      console.warn("Regex padrão falhou", e);
    }

    // 2. Tenta Força Bruta (caso ela envie sem os backticks do markdown!)
    if (!leadEncontradoAqui) {
      try {
         const firstP = originalText.indexOf('[');
         const lastP = originalText.lastIndexOf(']');
         if (firstP !== -1 && lastP !== -1 && lastP > firstP) {
            const rawArrayStr = originalText.substring(firstP, lastP + 1);
            const extraData = JSON.parse(rawArrayStr);
            if (Array.isArray(extraData) && extraData.length > 0 && typeof extraData[0] === 'object' && ('nome' in extraData[0])) {
               extraData.forEach(l => onLeadCaptured(l));
               // Remove o texto cru arrastado pra limpar a UI
               originalText = originalText.replace(rawArrayStr, ""); 
            }
         }
      } catch(e) {
         console.warn("Extrator Força Bruta falhou, texto não era json válido");
      }
    }
    
    // Limpeza ninja pra sumir apenas com o bloco que der match 
    const cleanResponseText = originalText.replace(/```(?:json)?\s*\[[\s\S]*?\]\s*```/gi, "").trim();

    return cleanResponseText;
  } catch (error) {
    console.error("Gemini API Error Detail:", error);
    return `Ocorreu um erro ao processar. Detalhe: ${error.message}`;
  }
}

// ============================================
// SISTEMA 2: ANA (OUTREACH / ABORDAGEM ATIVA)
// ============================================
export async function generateAnaMessage(lead, inventory) {
  try {
    const chat = model.startChat({
        generationConfig: { maxOutputTokens: 600, temperature: 0.8 } // Temperatura alta para máxima criatividade
    });

    const inventoryContext = JSON.stringify(inventory.map(i => ({Produto: i.name, Qtde: i.quantity, Preco: i.price})));
    
    const prompt = `Você é a ANA, a melhor e mais simpática vendedora da empresa. Sua especialidade é fazer "Cold Approach" (primeiro contato com clientes via WhatsApp).
    
    Nosso Estoque Atual:
    ${inventoryContext}
    
    DADOS DO CLIENTE ALVO (Lead):
    Nome da Loja/Pessoa: ${lead.nome}
    Site/Infos: ${lead.site || 'Não capturado'}
    
    SUA MISSÃO IMEDIATA:
    Escreva a primeira mensagem de WhatsApp que iremos mandar para ele. 
    REGRA DE OURO 1: Você é descontraída, amigável e MUITO FÃ DE EMOJIS! (Use emojis em quase todas as frases para quebrar o gelo).
    REGRA DE OURO 2: Se tivermos produtos relevantes no estoque para ele comprar, sutilmente cite-os usando nossa tabela de valores e puxe assunto para vender! Apele para as necessidades da loja dele.
    REGRA DE OURO 3: Retorne APENAS o texto da mensagem nua e crua. Não use marcação e não escreva "Mensagem:", pois a resposta que você gerar será copiada e colada ipsis litteris no WhatsApp pelo nosso vendedor.
    
    Mande a pedrada, Ana!`;

    const result = await chat.sendMessage(prompt);
    return result.response.text();
    
  } catch (error) {
    console.error("Ana Generation Error: ", error);
    return `Oooops! 🥺 A internet da Ana caiu ou deu um tilt no cerebelo dela! (${error.message})`;
  }
}
