import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.VITE_GEMINI_API_KEY || "AIzaSyCiJ6uL1V2vYQ-p_H_wI6bM6yV0m2p9_8"; // Backup if needed

async function listModels() {
  const genAI = new GoogleGenerativeAI(apiKey);
  try {
    const models = await genAI.listModels();
    console.log("--- MODELOS DISPONÍVEIS NA SUA CHAVE ---");
    console.log(JSON.stringify(models, null, 2));
  } catch (err) {
    console.error("Erro ao listar modelos:", err.message);
  }
}

listModels();
