"""Fixtures for provider-agnostic sandbox integration tests.

Provider selection via SANDBOX_TEST_PROVIDER env var:
    memory   (default) — in-process MemoryProvider, no infra needed
    daytona  — real Daytona sandbox (requires DAYTONA_API_KEY)

Usage:
    # Default: in-memory (fast, no infra)
    uv run pytest tests/integration/sandbox/ -v

    # Against real Daytona:
    SANDBOX_TEST_PROVIDER=daytona DAYTONA_API_KEY=... uv run pytest tests/integration/sandbox/ -v

IMPORTANT: When using real providers, every sandbox created during tests is
deleted in fixture teardown to avoid resource leaks.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest
import pytest_asyncio

from ptc_agent.config.core import (
    CoreConfig,
    DaytonaConfig,
    FilesystemConfig,
    LoggingConfig,
    MCPConfig,
    SandboxConfig,
    SecurityConfig,
)
from ptc_agent.core.sandbox.runtime import SandboxProvider, SandboxRuntime

from .memory_provider import MemoryProvider, MemoryRuntime

# ---------------------------------------------------------------------------
# Provider detection
# ---------------------------------------------------------------------------

SANDBOX_TEST_PROVIDER = os.getenv("SANDBOX_TEST_PROVIDER", "memory").lower()


def _is_real_provider() -> bool:
    """True when testing against a real external provider (not memory)."""
    return SANDBOX_TEST_PROVIDER != "memory"


# ---------------------------------------------------------------------------
# Shared config builder
# ---------------------------------------------------------------------------


def _make_core_config(
    working_directory: str,
    provider: str = "daytona",
    api_key: str = "test-key",
    base_url: str = "https://app.daytona.io/api",
) -> CoreConfig:
    """Build a CoreConfig suitable for testing."""
    return CoreConfig(
        sandbox=SandboxConfig(
            provider=provider if provider in ("daytona", "docker") else "daytona",
            daytona=DaytonaConfig(
                api_key=api_key,
                base_url=base_url,
                snapshot_enabled=False,  # skip snapshot for tests
            ),
        ),
        security=SecurityConfig(
            max_execution_time=60,
            max_code_length=50000,
            max_file_size=10485760,
            enable_code_validation=False,
            allowed_imports=[],
            blocked_patterns=[],
        ),
        mcp=MCPConfig(servers=[], tool_discovery_enabled=False),
        logging=LoggingConfig(),
        filesystem=FilesystemConfig(
            working_directory=working_directory,
            allowed_directories=[working_directory, "/tmp"],
            denied_directories=[],
            enable_path_validation=True,
        ),
    )


# ---------------------------------------------------------------------------
# Provider fixtures — dual-mode (memory or real)
# ---------------------------------------------------------------------------


@pytest.fixture
def sandbox_base_dir(tmp_path):
    """Temporary directory for sandbox working dirs (memory provider only)."""
    d = tmp_path / "sandboxes"
    d.mkdir()
    return str(d)


@pytest.fixture
def memory_provider(sandbox_base_dir) -> MemoryProvider:
    """Fresh MemoryProvider — always available for memory-only runtime tests."""
    return MemoryProvider(base_dir=sandbox_base_dir)


@pytest_asyncio.fixture
async def memory_runtime(memory_provider) -> MemoryRuntime:
    """A single MemoryRuntime — always memory, used by test_runtime_lifecycle.py."""
    runtime = await memory_provider.create(env_vars={"TEST_VAR": "hello"})
    yield runtime
    try:
        state = await runtime.get_state()
        if state.value == "running":
            await runtime.stop()
    except Exception:
        pass


@pytest_asyncio.fixture
async def sandbox_provider(sandbox_base_dir) -> SandboxProvider:
    """Provider instance matching SANDBOX_TEST_PROVIDER.

    For memory: returns MemoryProvider.
    For daytona: returns DaytonaProvider with real API key.

    Teardown: closes the provider's HTTP client.
    """
    if SANDBOX_TEST_PROVIDER == "daytona":
        api_key = os.environ.get("DAYTONA_API_KEY", "")
        if not api_key:
            pytest.skip("DAYTONA_API_KEY not set")
        base_url = os.environ.get(
            "DAYTONA_BASE_URL", "https://app.daytona.io/api"
        )
        from ptc_agent.core.sandbox.providers.daytona import DaytonaProvider

        provider = DaytonaProvider(
            DaytonaConfig(
                api_key=api_key,
                base_url=base_url,
                snapshot_enabled=False,
            )
        )
        yield provider
        await provider.close()
    else:
        yield MemoryProvider(base_dir=sandbox_base_dir)


@pytest_asyncio.fixture
async def sandbox_runtime(sandbox_provider) -> SandboxRuntime:
    """A single runtime from the active provider, with guaranteed cleanup.

    IMPORTANT: Deletes the sandbox on teardown so real providers don't leak.
    """
    runtime = await sandbox_provider.create(env_vars={"TEST_VAR": "hello"})
    yield runtime
    # Guaranteed cleanup: delete the sandbox no matter what
    try:
        state = await runtime.get_state()
        if state.value in ("running", "stopped", "archived"):
            await runtime.delete()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Core config fixture — adapts to provider
# ---------------------------------------------------------------------------


@pytest.fixture
def core_config(sandbox_base_dir) -> CoreConfig:
    """CoreConfig adapted to the active test provider."""
    if SANDBOX_TEST_PROVIDER == "daytona":
        api_key = os.environ.get("DAYTONA_API_KEY", "")
        if not api_key:
            pytest.skip("DAYTONA_API_KEY not set")
        base_url = os.environ.get(
            "DAYTONA_BASE_URL", "https://app.daytona.io/api"
        )
        return _make_core_config(
            working_directory="/home/daytona",
            provider="daytona",
            api_key=api_key,
            base_url=base_url,
        )

    # memory provider — use temp dir as working directory
    return _make_core_config(
        working_directory=sandbox_base_dir,
        provider="daytona",  # value ignored since create_provider is patched
        api_key="test-key",
    )


# ---------------------------------------------------------------------------
# Provider patching — only for memory provider
# ---------------------------------------------------------------------------


@pytest.fixture
def _patch_create_provider(memory_provider):
    """Patch create_provider for memory provider, or no-op for real providers."""
    if _is_real_provider():
        yield None
        return

    with patch(
        "ptc_agent.core.sandbox.ptc_sandbox.create_provider",
        return_value=memory_provider,
    ):
        yield memory_provider
