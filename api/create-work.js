export default function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Usa POST" });
    }

    let body = req.body;

    // 🔧 caso venha como texto
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        // tenta extrair manualmente
        const match = body.match(/topic=(.*)/);
        if (match) {
          body = { topic: match[1] };
        }
      }
    }

    const topic = body?.topic;

    if (!topic) {
      return res.status(400).json({
        error: "Falta o tema"
      });
    }

    return res.status(200).json({
      topic,
      title: `Trabalho sobre ${topic}`,
      outline: [
        "Introdução",
        "Desenvolvimento",
        "Conclusão"
      ],
      status: "created"
    });

  } catch (error) {
    return res.status(500).json({
      error: "Erro interno",
      detalhe: error.message
    });
  }
}
