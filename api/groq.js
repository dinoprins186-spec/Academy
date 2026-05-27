export default function handler(req, res) {
  return res.status(410).json({
    error: 'Groq desativado. Use /api/engine'
  });
}
