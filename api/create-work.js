export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Use POST method"
    });
  }

  const { topic } = req.body;

  if (!topic) {
    return res.status(400).json({
      error: "Topic is required"
    });
  }

  // 🧠 estrutura base da Academy
  const work = {
    topic,
    title: `Trabalho sobre ${topic}`,
    outline: [
      "Introdução",
      "Desenvolvimento",
      "Conclusão"
    ],
    status: "created"
  };

  return res.status(200).json(work);
}
