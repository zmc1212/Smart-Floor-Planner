"""Official PydanticAI output-function validation and ModelRetry recovery."""
import asyncio
import json
import sys
import httpx2 as httpx
from openai import AsyncOpenAI
from pydantic_ai import Agent, ModelRetry, ToolOutput
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import UsageLimits


async def main():
    config = json.load(sys.stdin)
    async with httpx.AsyncClient(timeout=100, trust_env=False) as client:
        async def submit(action: str, changes: list[dict], answer: str, evidenceIds: list[str]) -> str:
            response = await client.post(config['bridgeURL'] + '/contract/execute',
                headers={'Authorization': 'Bearer ' + config['apiKey']},
                json={'args': dict(action=action, changes=changes, answer=answer, evidenceIds=evidenceIds)})
            response.raise_for_status()
            result = response.json()
            if not result.get('terminal'):
                raise ModelRetry(json.dumps(result, ensure_ascii=False))
            return result['text']

        sdk = AsyncOpenAI(base_url=config['baseURL'], api_key=config['apiKey'], max_retries=0, timeout=95, http_client=client)
        definition = config['protocol']['tools'][0]
        agent = Agent(OpenAIChatModel(config['model'], provider=OpenAIProvider(openai_client=sdk)),
            system_prompt=config['system'],
            output_type=ToolOutput(submit, name=definition['name'], description=definition['description'], max_retries=2),
            retries={'tools': 2, 'output': 2}, model_settings={'temperature': 0.2, 'max_tokens': 2048, 'parallel_tool_calls': False})
        result = await agent.run(config['text'], usage_limits=UsageLimits(request_limit=3))
        print(json.dumps({'textResponse': result.output, 'messages': json.loads(result.all_messages_json())}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
