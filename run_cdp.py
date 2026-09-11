import json
import urllib.request
import asyncio
import websockets

async def run():
    # Get the WebSocket URL
    req = urllib.request.Request("http://127.0.0.1:63723/json/list")
    with urllib.request.urlopen(req) as response:
        pages = json.loads(response.read().decode())
    
    ws_url = None
    for page in pages:
        if page.get("type") == "page":
            ws_url = page.get("webSocketDebuggerUrl")
            break
            
    if not ws_url:
        print("No page found")
        return

    print("Connecting to", ws_url)
    async with websockets.connect(ws_url) as ws:
        async def exec_js(script):
            msg = {
                "id": 1,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": script,
                    "returnByValue": True
                }
            }
            await ws.send(json.dumps(msg))
            resp = await ws.recv()
            return json.loads(resp)

        script = """
        (function() {
            let input = document.querySelector('textarea, [contenteditable="true"]');
            if (!input) return "No input found";
            
            let prompt = "请使用设计方案汇报技能（design-presentation-web），结合本地 customer-materials 生成一份家装设计方案汇报，让我看看原程序生成的效果。";
            
            if (input.tagName === 'TEXTAREA') {
                input.value = prompt;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                input.textContent = prompt;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            
            let sendBtn = document.querySelector('button[aria-label="Send message"], button[title="Send message"], button:has(svg)');
            if (sendBtn) {
                sendBtn.click();
                return "Clicked send button";
            }
            
            input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true
            }));
            
            return "Dispatched Enter key";
        })()
        """
        
        result = await exec_js(script)
        print("Result:", result)

asyncio.run(run())
