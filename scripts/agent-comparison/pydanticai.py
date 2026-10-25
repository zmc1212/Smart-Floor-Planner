"""Use PydanticAI's own runner, output functions and function tools.

The host enforces the canonical provider schema and owns tenant/business services.
Only a short-lived local bridge credential is passed on stdin, never a provider key.
"""
import asyncio
import json
import sys
from typing import Literal

import httpx2 as httpx
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict
from pydantic_ai import Agent, Tool, ToolOutput
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import UsageLimits


class Field(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: Literal["housing", "household", "style", "budget", "timeline", "room", "space", "usage", "frequency", "devices"]
    text: str
    sourceMessageId: str


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    refId: str
    quote: str


async def main():
    config = json.load(sys.stdin)
    headers = {"Authorization": "Bearer " + config["apiKey"]}
    async with httpx.AsyncClient(timeout=100, trust_env=False) as client:
        async def execute(name, values):
            args = {key: value for key, value in values.items() if value is not None}
            for key in ("fields", "answerEvidence"):
                if key in args:
                    args[key] = [item.model_dump() for item in args[key]]
            response = await client.post(config["bridgeURL"] + "/comparison/tools", headers=headers,
                                         json={"name": name, "args": args})
            response.raise_for_status()
            return response.json()["text"]

        outputs = [str]
        tools = []
        for definition in config["protocol"]["tools"]:
            name = definition["name"]
            if definition.get("direct"):
                def make_output(tool_name):
                    async def business(action: str | None = None, quote: str | None = None,
                                       sourceSeq: str | None = None, fields: list[Field] | None = None,
                                       answerEvidence: list[Evidence] | None = None) -> str:
                        return await execute(tool_name, dict(action=action, quote=quote, sourceSeq=sourceSeq,
                                                            fields=fields, answerEvidence=answerEvidence))
                    return business
                outputs.append(ToolOutput(make_output(name), name=name, description=definition["description"],
                                          max_retries=0, sequential=True))
            else:
                def make_search(tool_name):
                    async def search(**values):
                        return await execute(tool_name, values)
                    return search
                tools.append(Tool.from_schema(make_search(name), name=name, description=definition["description"],
                                              json_schema=definition["parameters"], takes_ctx=False))

        sdk = AsyncOpenAI(base_url=config["baseURL"], api_key=config["apiKey"], max_retries=0,
                          timeout=95, http_client=client)
        agent = Agent(OpenAIChatModel(config["model"], provider=OpenAIProvider(openai_client=sdk)),
                      system_prompt=config["system"], output_type=outputs, tools=tools,
                      retries={"tools": 0, "output": 0},
                      model_settings={"temperature": 0.2, "max_tokens": 2048, "parallel_tool_calls": False})
        result = await agent.run(config["text"], usage_limits=UsageLimits(request_limit=4))
        print(json.dumps({"textResponse": result.output,
                          "messages": json.loads(result.all_messages_json())}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
