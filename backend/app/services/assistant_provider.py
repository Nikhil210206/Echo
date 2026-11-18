"""Groq chat-completions adapter for declared, local tool calls."""
import asyncio
import os
from dataclasses import dataclass, field
from typing import Literal

import httpx
from pydantic import BaseModel, Field

DEFAULT_MODEL = "openai/gpt-oss-20b"
URL = "https://api.groq.com/openai/v1/chat/completions"


class ToolFunction(BaseModel):
    name: str = Field(max_length=64)
    arguments: str = Field(max_length=4000)


class ToolCall(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    function: ToolFunction
    type: Literal["function"] = "function"


class ProviderMessage(BaseModel):
    content: str | None = Field(default=None, max_length=8000)
    tool_calls: list[ToolCall] | None = Field(default=None, max_length=2)


@dataclass(frozen=True)
class GroqProvider:
    api_key: str = field(repr=False)
    model: str

    async def _chat(self, messages, tools, timeout) -> ProviderMessage:
        async with httpx.AsyncClient(timeout=timeout) as client:
            body = {
                "model": self.model, "messages": messages, "temperature": 0,
                "max_completion_tokens": 1200,
            }
            if tools:
                body.update(tools=tools, tool_choice="auto")
            response = await client.post(URL, headers={"Authorization": f"Bearer {self.api_key}"}, json=body)
            response.raise_for_status()
            return ProviderMessage.model_validate(response.json()["choices"][0]["message"])

    def chat(self, messages, tools, *, timeout: float) -> ProviderMessage:
        return asyncio.run(asyncio.wait_for(self._chat(messages, tools, timeout), timeout))


def configured_provider() -> GroqProvider | None:
    key = os.getenv("ASSISTANT_GROQ_API_KEY", "").strip()
    model = os.getenv("ASSISTANT_GROQ_MODEL", DEFAULT_MODEL).strip()
    return GroqProvider(key, model) if key and model else None
