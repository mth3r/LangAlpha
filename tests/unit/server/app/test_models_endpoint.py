"""
Tests for GET /api/v1/models — public model listing endpoint.

Covers:
- Response shape: models, model_metadata, system_defaults
- System defaults populated from agent_config.yaml
- Multiple providers in response
- Model metadata propagation
- No auth required
"""

from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from tests.conftest import create_test_app

DB = "src.server.app.api_keys"


@pytest_asyncio.fixture
async def client():
    from src.server.app.api_keys import router
    import src.server.app.api_keys as api_keys_mod

    api_keys_mod._BYOK_PROVIDERS_CACHE = None

    app = create_test_app(router)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        with (
            patch(f"{DB}._get_supported_providers", return_value=["openai", "anthropic"]),
            patch(f"{DB}._get_provider_display_names", return_value={"openai": "OpenAI", "anthropic": "Anthropic"}),
        ):
            yield c

    api_keys_mod._BYOK_PROVIDERS_CACHE = None


# ---------------------------------------------------------------------------
# Response shape
# ---------------------------------------------------------------------------


class TestListModelsResponse:
    @pytest.mark.asyncio
    async def test_response_has_required_keys(self, client):
        mock_models = {"openai": [{"name": "gpt-4o", "model_id": "gpt-4o"}]}
        mock_mc = MagicMock()
        mock_mc.get_display_name.side_effect = lambda p: p.title()
        mock_mc.get_model_metadata.return_value = {}

        mock_llm_cls = MagicMock()
        mock_llm_cls.get_model_config.return_value = mock_mc

        with (
            patch("src.llms.llm.get_configured_llm_models", return_value=mock_models),
            patch("src.llms.llm.LLM", mock_llm_cls),
            patch(
                "src.config.settings.load_agent_config",
                return_value={"llm": {"name": "gpt-4o", "flash": "gpt-4o-mini"}},
            ),
        ):
            resp = await client.get("/api/v1/models")

        assert resp.status_code == 200
        body = resp.json()
        assert "models" in body
        assert "model_metadata" in body
        assert "system_defaults" in body

    @pytest.mark.asyncio
    async def test_system_defaults_populated(self, client):
        """System defaults should come from agent_config.yaml LLM section."""
        mock_models = {}
        mock_mc = MagicMock()
        mock_mc.get_display_name.side_effect = lambda p: p
        mock_mc.get_model_metadata.return_value = {}

        mock_llm_cls = MagicMock()
        mock_llm_cls.get_model_config.return_value = mock_mc

        llm_config = {
            "name": "claude-sonnet-4-5",
            "flash": "claude-haiku-4-5",
            "summarization": "claude-haiku-4-5",
            "fetch": "claude-haiku-4-5",
            "fallback": ["gpt-4o"],
        }
        with (
            patch("src.llms.llm.get_configured_llm_models", return_value=mock_models),
            patch("src.llms.llm.LLM", mock_llm_cls),
            patch(
                "src.config.settings.load_agent_config",
                return_value={"llm": llm_config},
            ),
        ):
            resp = await client.get("/api/v1/models")

        body = resp.json()
        defaults = body["system_defaults"]
        assert defaults["default_model"] == "claude-sonnet-4-5"
        assert defaults["flash_model"] == "claude-haiku-4-5"
        assert defaults["summarization_model"] == "claude-haiku-4-5"
        assert defaults["fetch_model"] == "claude-haiku-4-5"
        assert defaults["fallback_models"] == ["gpt-4o"]

    @pytest.mark.asyncio
    async def test_system_defaults_string_llm_bug(self, client):
        """BUG: When LLM config is a string, the endpoint crashes.

        The /api/v1/models endpoint calls llm_cfg.get("name") which fails
        when llm_cfg is a string instead of a dict. This documents the
        existing bug for regression tracking.
        """
        mock_models = {}
        mock_mc = MagicMock()
        mock_mc.get_display_name.side_effect = lambda p: p
        mock_mc.get_model_metadata.return_value = {}

        mock_llm_cls = MagicMock()
        mock_llm_cls.get_model_config.return_value = mock_mc

        with (
            patch("src.llms.llm.get_configured_llm_models", return_value=mock_models),
            patch("src.llms.llm.LLM", mock_llm_cls),
            patch(
                "src.config.settings.load_agent_config",
                return_value={"llm": "gpt-4o"},
            ),
            pytest.raises(AttributeError, match="'str' object has no attribute 'get'"),
        ):
            await client.get("/api/v1/models")

    @pytest.mark.asyncio
    async def test_multiple_providers(self, client):
        mock_models = {
            "openai": [
                {"name": "gpt-4o", "model_id": "gpt-4o"},
                {"name": "gpt-4o-mini", "model_id": "gpt-4o-mini"},
            ],
            "anthropic": [
                {"name": "claude-sonnet-4-5", "model_id": "claude-sonnet-4-20250514"},
            ],
        }
        mock_mc = MagicMock()
        mock_mc.get_display_name.side_effect = lambda p: p.title()
        mock_mc.get_model_metadata.return_value = {"sdk": "openai"}

        mock_llm_cls = MagicMock()
        mock_llm_cls.get_model_config.return_value = mock_mc

        with (
            patch("src.llms.llm.get_configured_llm_models", return_value=mock_models),
            patch("src.llms.llm.LLM", mock_llm_cls),
            patch(
                "src.config.settings.load_agent_config",
                return_value={"llm": {"name": "gpt-4o"}},
            ),
        ):
            resp = await client.get("/api/v1/models")

        body = resp.json()
        assert "openai" in body["models"]
        assert "anthropic" in body["models"]
        assert len(body["models"]["openai"]["models"]) == 2
        assert len(body["models"]["anthropic"]["models"]) == 1

    @pytest.mark.asyncio
    async def test_no_auth_required(self, client):
        """The models endpoint should work without authentication."""
        mock_models = {}
        mock_mc = MagicMock()
        mock_mc.get_display_name.side_effect = lambda p: p
        mock_mc.get_model_metadata.return_value = {}

        mock_llm_cls = MagicMock()
        mock_llm_cls.get_model_config.return_value = mock_mc

        with (
            patch("src.llms.llm.get_configured_llm_models", return_value=mock_models),
            patch("src.llms.llm.LLM", mock_llm_cls),
            patch(
                "src.config.settings.load_agent_config",
                return_value={"llm": {"name": "test"}},
            ),
        ):
            resp = await client.get("/api/v1/models")

        assert resp.status_code == 200
