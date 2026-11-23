"""Ollama se baat karne ka sabse chhota Python example."""
import json
import urllib.request

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
MODEL = "qwen2.5:0.5b"

data = {
    "model": MODEL,
    "prompt": "Hindi mein ek chhota johans likho.",
    "stream": False,
}

req = urllib.request.Request(
    OLLAMA_URL,
    data=json.dumps(data).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=120) as res:
    result = json.load(res)

print(result["response"])
