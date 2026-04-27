import sys
import json
import os

# Set encoding to avoid issues
sys.stdout.reconfigure(encoding='utf-8')

# Mocking the call to list_tools.py logic if it's too complex, or just use the file
# But I'll try to use the output of list_tools.py by reading it from a temp file
os.system('python G:\\AI\\Skills\\tensorart-skills\\skills\\tensorart-generate\\scripts\\list_tools.py > tools.json')

with open('tools.json', 'r', encoding='utf-8') as f:
    tools = json.load(f)
    controlnet_tools = [t for t in tools if 'ControlNet' in str(t)]
    print(json.dumps(controlnet_tools, indent=2, ensure_ascii=False))
