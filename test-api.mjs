import { GoogleGenerativeAI } from '@google/generative-ai';
const genAI = new GoogleGenerativeAI('AIzaSyD00kthnrWW_E4jesneySYaV-jatpaEPMg');

async function run() {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent('Oi');
    console.log('1.5-flash SUCCESS:', result.response.text());
  } catch(e) {
    console.error('1.5-flash FAILED:', e.message);
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent('Oi');
    console.log('pro SUCCESS:', result.response.text());
  } catch(e) {
    console.error('pro FAILED:', e.message);
  }
}

run();
