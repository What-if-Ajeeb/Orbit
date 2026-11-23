// Ollama se baat karne ka sabse chhota Node.js example (Node 18+).
const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const MODEL = "qwen2.5:0.5b";

async function main() {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: "Hindi mein ek chhota johans likho.",
      stream: false,
    }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  console.log(data.response);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
