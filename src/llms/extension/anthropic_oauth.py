"""ChatAnthropic variant that uses OAuth Bearer auth (auth_token) instead of API key (X-Api-Key)."""

from typing import Any

from langchain_anthropic import ChatAnthropic


class ChatAnthropicOAuth(ChatAnthropic):
    """ChatAnthropic that sends ``Authorization: Bearer <token>`` instead of ``X-Api-Key``.

    The Anthropic Python SDK supports two auth modes:
      - ``api_key``   → ``X-Api-Key`` header  (standard API keys)
      - ``auth_token`` → ``Authorization: Bearer`` header  (OAuth tokens)

    LangChain's ``ChatAnthropic`` only passes ``api_key``.  This subclass
    intercepts ``_client_params`` so the OAuth token goes through ``auth_token``.
    """

    @property
    def _client_params(self) -> dict[str, Any]:
        params = super()._client_params
        # Move the value from api_key → auth_token so the SDK sends Bearer auth
        token = params.pop("api_key", None)
        params["api_key"] = None
        params["auth_token"] = token
        return params
