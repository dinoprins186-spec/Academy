export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'Chave não configurada no servidor' });
  }

  try {
    const resposta = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify(req.body)
    });

    const dados = await resposta.json();
    return res.status(resposta.status).json(dados);

  } catch (erro) {
    return res.status(500).json({ error: 'Erro ao contactar a Groq: ' + erro.message });
  }
}
