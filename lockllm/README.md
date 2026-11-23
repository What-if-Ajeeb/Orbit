# Ollama Setup (Hinglish Guide)

## Kya install hua?

- **Ollama** `v0.40.17` — `/usr/local/bin/ollama`
- Server: `http://127.0.0.1:11434` (network se bhi accessible: `0.0.0.0:11434`)
- Model: `qwen2.5:0.5b` (397 MB) — CPU + 5.4 GB RAM ke liye halka model
- Logs: `logs/ollama.log`

> Is container mein `systemd` nahi hai, isliye server `nohup` se background mein chal raha hai.

## Hamesha ON rakhna (watchdog)

Ek watcher background mein chal raha hai jo har 10 second me server check karta hai aur
girne par khud restart kar deta hai:

```bash
bash /root/orbit/lockllm/keep-ollama.sh     # shuru (already chal raha hai)
ps -eo pid,args | grep '[k]eep-ollama' # status
tail -f /root/orbit/lockllm/logs/ollama-watchdog.log
```

> Container/pod khud restart ho jaye to ek baar `bash /root/orbit/lockllm/start-ollama.sh`
> aur `bash /root/orbit/lockllm/keep-ollama.sh` chala dena — is environment me persistent
> init system (systemd/cron) available nahi hai.

## Roz ka use

```bash
# Server start karein (agar nahi chal raha)
bash /root/orbit/lockllm/start-ollama.sh

# Status / model list
curl http://127.0.0.1:11434/api/version
ollama list

# Terminal mein chat
ollama run qwen2.5:0.5b

# Ek baar ka sawal
ollama run qwen2.5:0.5b "Namaste kaise ho?"
```

## Naya model download karein

```bash
ollama pull gemma3:1b        # thoda better, ~1 GB
ollama pull llama3.2:1b      # ~1.3 GB
ollama pull qwen2.5:7b       # CPU par slow, zyada RAM chahiye
```

> RAM kam hai (~5.4 GB, GPU nahi), isliye 0.5B–1B models best rahenge.

## Apni app ko link karna

Ollama ek simple HTTP API deta hai — kisi bhi language se call kar sakte ho.

### Base URL
```
http://127.0.0.1:11434
```

### 1. curl se test

```bash
curl http://127.0.0.1:11434/api/generate \
  -d '{"model":"qwen2.5:0.5b","prompt":"Hello!","stream":false}'
```

### 2. Chat API (multi-turn) — recommended

```bash
curl http://127.0.0.1:11434/api/chat -d '{
  "model": "qwen2.5:0.5b",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant. Hindi mein jawab do."},
    {"role": "user", "content": "Namaste!"}
  ],
  "stream": false
}'
```

### 3. Python

```python
import urllib.request, json

def ask(prompt):
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/generate",
        data=json.dumps({"model": "qwen2.5:0.5b", "prompt": prompt, "stream": False}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["response"]

print(ask("Namaste!"))
```

`examples/python_client.py` bhi dekho. Agar package use karna hai:
```bash
pip install ollama
```

```python
import ollama
print(ollama.generate(model="qwen2.5:0.5b", prompt="Namaste!")["response"])
```

### 4. Node.js / browser

```bash
npm install ollama
```

```js
import { ollama } from 'ollama';
const res = await ollama.chat({
  model: 'qwen2.5:0.5b',
  messages: [{ role: 'user', content: 'Namaste!' }],
});
console.log(res.message.content);
```

`examples/node_client.js` bhi dekho (bina package ke, built-in fetch se).

### 5. Browser app (CORS)

Server `OLLAMA_ORIGINS=*` ke saath chal raha hai, isliye browser se direct call chalega:

```js
const res = await fetch('http://127.0.0.1:11434/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'qwen2.5:0.5b',
    messages: [{ role: 'user', content: 'Namaste!' }],
    stream: false,
  }),
});
const data = await res.json();
console.log(data.message.content);
```

### 6. Agar app doosre machine/container mein hai

`127.0.0.1` ki jagah is machine ka IP use karo:

```bash
hostname -I | awk '{print $1}'
```

Phir URL: `http://<IP>:11434`. Firewall/security group mein port `11434` kholna hoga.

## Streaming (typing effect)

`"stream": true` karo — server line-by-line JSON chunks bhejega. Har chunk mein
`response` field hota hai aur aakhiri chunk mein `done: true`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `could not connect to a running Ollama instance` | `bash /root/orbit/lockllm/start-ollama.sh` |
| Port busy | `OLLAMA_PORT=11435 bash /root/orbit/lockllm/start-ollama.sh` |
| App isi phone par hai, `100.x` IP kaam na kare | Server URL me `http://127.0.0.1:11434/v1`.use karein (is device par sirf mobile-data/CGNAT IP hai, LAN IP nahi) |
| Browser me `/v1` kholne par 404 | Normal hai — `/v1` base URL hai, page nahi. Test karein: `/` ya `/api/tags` |
| Origin/CORS error | `OLLAMA_ORIGINS='*' bash /root/orbit/lockllm/start-ollama.sh` |
| Slow response | Chhota model use karo ya `ollama ps` se purana model unload karo |
| Logs dekhne ke liye | `tail -f /root/orbit/lockllm/logs/ollama.log` |

## Security note

Server `0.0.0.0` par chal raha hai aur CORS `*` hai — development ke liye theek hai.
Production mein sirf localhost par rakho aur apne app ke backend ke through proxy karo.
