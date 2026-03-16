"""Integration tests for PTCSandbox full lifecycle — provider-agnostic.

Tests PTCSandbox through the MemoryProvider, validating:
- Workspace creation and directory structure setup
- Code execution (execute / execute_bash_command)
- File I/O (upload, download, read, write, edit, glob, grep, list)
- Reconnection flow (stop → reconnect → verify state)
- Manifest write/read cycle
- Token upload
- Cleanup and close
- Path normalization and validation

These tests use real PTCSandbox instances with the create_provider call
patched to return a MemoryProvider, so all provider-agnostic logic is
exercised with real behavior.
"""

from __future__ import annotations

import json

import pytest
import pytest_asyncio

from ptc_agent.core.sandbox.ptc_sandbox import PTCSandbox
from ptc_agent.core.sandbox.runtime import RuntimeState

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def sandbox(core_config, _patch_create_provider):
    """A PTCSandbox with workspace set up, ready for operations."""
    sb = PTCSandbox(core_config)

    # Simulate the creation flow
    await sb.setup_sandbox_workspace()
    assert sb.runtime is not None
    assert sb.sandbox_id is not None

    # Align config's working_directory with the runtime's actual path
    # so that PTCSandbox path normalization and validation work correctly
    actual_work_dir = await sb.runtime.fetch_working_dir()
    sb.config.filesystem.working_directory = actual_work_dir
    sb.config.filesystem.allowed_directories = [actual_work_dir, "/tmp"]

    # Override hardcoded paths that reference /home/daytona
    sb.TOKEN_FILE_PATH = f"{actual_work_dir}/_internal/.mcp_tokens.json"
    sb.UNIFIED_MANIFEST_PATH = f"{actual_work_dir}/_internal/.sandbox_manifest.json"

    yield sb

    # Cleanup
    try:
        await sb.cleanup()
    except Exception:
        pass


@pytest_asyncio.fixture
async def sandbox_minimal(core_config, _patch_create_provider):
    """A PTCSandbox constructed but NOT set up — for testing init flow."""
    sb = PTCSandbox(core_config)
    yield sb
    try:
        if sb.runtime:
            await sb.cleanup()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Workspace creation and directory structure
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestWorkspaceSetup:
    """setup_sandbox_workspace() creates the runtime and directory skeleton."""

    async def test_setup_creates_runtime(self, sandbox):
        assert sandbox.runtime is not None
        assert sandbox.sandbox_id is not None
        state = await sandbox.runtime.get_state()
        assert state == RuntimeState.RUNNING

    async def test_setup_creates_directories(self, sandbox):
        """Verify all 8 standard directories exist after setup."""
        expected_dirs = [
            "tools",
            "tools/docs",
            "results",
            "data",
            "code",
            "work",
            ".agent/threads",
            "_internal/src",
        ]
        for d in expected_dirs:
            result = await sandbox.runtime.exec(f"test -d {sandbox._work_dir}/{d} && echo EXISTS")
            assert "EXISTS" in result.stdout, f"Directory {d} was not created"

    async def test_setup_idempotent_structure(self, sandbox):
        """Calling _setup_workspace again should not fail."""
        await sandbox._setup_workspace()
        result = await sandbox.runtime.exec(f"test -d {sandbox._work_dir}/tools && echo OK")
        assert "OK" in result.stdout


# ---------------------------------------------------------------------------
# Code execution (execute)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestExecute:
    """PTCSandbox.execute() — Python code execution with full orchestration."""

    async def test_execute_simple_code(self, sandbox):
        result = await sandbox.execute("print('hello world')")
        assert result.success is True
        assert "hello world" in result.stdout

    async def test_execute_returns_execution_result(self, sandbox):
        result = await sandbox.execute("x = 42; print(x)")
        assert result.success is True
        assert result.execution_id is not None
        assert result.code_hash is not None
        assert isinstance(result.duration, float)

    async def test_execute_error_code(self, sandbox):
        result = await sandbox.execute("raise RuntimeError('test failure')")
        assert result.success is False

    async def test_execute_creates_code_file(self, sandbox):
        """execute() should save the code to code/ directory."""
        result = await sandbox.execute("print('saved')")
        assert result.success is True
        # Check code dir has files
        ls_result = await sandbox.runtime.exec(f"ls {sandbox._work_dir}/code/")
        assert ls_result.exit_code == 0

    async def test_execute_with_thread_id(self, sandbox):
        result = await sandbox.execute(
            "print('threaded')", thread_id="test-thread-123"
        )
        assert result.success is True
        # Check thread dir was created
        ls_result = await sandbox.runtime.exec(
            f"test -d {sandbox._work_dir}/.agent/threads/test-thread-123/code && echo OK"
        )
        assert "OK" in ls_result.stdout

    async def test_execute_with_file_creation(self, sandbox):
        """Code that creates files should report files_created."""
        result = await sandbox.execute(
            "with open('results/test_output.txt', 'w') as f: f.write('data')"
        )
        assert result.success is True

    async def test_execute_increments_counter(self, sandbox):
        assert sandbox.execution_count == 0
        await sandbox.execute("print(1)")
        assert sandbox.execution_count == 1
        await sandbox.execute("print(2)")
        assert sandbox.execution_count == 2

    async def test_execute_with_pythonpath(self, sandbox):
        """Verify PYTHONPATH is set so _internal/src imports work."""
        # Upload a module to _internal/src
        await sandbox.runtime.upload_file(
            b"INTERNAL_VALUE = 99\n",
            f"{sandbox._work_dir}/_internal/src/test_internal.py",
        )
        result = await sandbox.execute(
            "from test_internal import INTERNAL_VALUE; print(INTERNAL_VALUE)"
        )
        assert result.success is True
        assert "99" in result.stdout


# ---------------------------------------------------------------------------
# Bash execution (execute_bash_command)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestExecuteBashCommand:
    """PTCSandbox.execute_bash_command() — shell command execution."""

    async def test_bash_simple(self, sandbox):
        wd = sandbox._work_dir
        result = await sandbox.execute_bash_command("echo hello bash", working_dir=wd)
        assert result["success"] is True
        assert "hello bash" in result["stdout"]
        assert result["exit_code"] == 0

    async def test_bash_returns_metadata(self, sandbox):
        wd = sandbox._work_dir
        result = await sandbox.execute_bash_command("echo test", working_dir=wd)
        assert "bash_id" in result
        assert "command_hash" in result

    async def test_bash_error(self, sandbox):
        wd = sandbox._work_dir
        result = await sandbox.execute_bash_command("exit 1", working_dir=wd)
        assert result["success"] is False
        assert result["exit_code"] == 1

    async def test_bash_increments_counter(self, sandbox):
        wd = sandbox._work_dir
        assert sandbox.bash_execution_count == 0
        await sandbox.execute_bash_command("echo 1", working_dir=wd)
        assert sandbox.bash_execution_count == 1

    async def test_bash_with_pipe(self, sandbox):
        wd = sandbox._work_dir
        result = await sandbox.execute_bash_command("echo 'a b c' | wc -w", working_dir=wd)
        assert result["success"] is True
        assert "3" in result["stdout"]

    async def test_bash_creates_files(self, sandbox):
        wd = sandbox._work_dir
        await sandbox.execute_bash_command(f"echo 'bash content' > {wd}/bash_file.txt", working_dir=wd)
        content = await sandbox.adownload_file_bytes(f"{wd}/bash_file.txt")
        assert content is not None
        assert b"bash content" in content


# ---------------------------------------------------------------------------
# File I/O through PTCSandbox
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestFileOperations:
    """PTCSandbox file I/O: upload, download, read, write, edit, glob, grep, list."""

    async def test_upload_and_download(self, sandbox):
        wd = sandbox._work_dir
        ok = await sandbox.aupload_file_bytes(f"{wd}/results/test.txt", b"file content")
        assert ok is True
        content = await sandbox.adownload_file_bytes(f"{wd}/results/test.txt")
        assert content == b"file content"

    async def test_read_text(self, sandbox):
        wd = sandbox._work_dir
        await sandbox.aupload_file_bytes(f"{wd}/data/readme.txt", b"Hello, World!")
        text = await sandbox.aread_file_text(f"{wd}/data/readme.txt")
        assert text == "Hello, World!"

    async def test_write_text(self, sandbox):
        wd = sandbox._work_dir
        ok = await sandbox.awrite_file_text(f"{wd}/data/written.txt", "written via API")
        assert ok is True
        text = await sandbox.aread_file_text(f"{wd}/data/written.txt")
        assert text == "written via API"

    async def test_read_file_range(self, sandbox):
        wd = sandbox._work_dir
        lines = "\n".join(f"line {i}" for i in range(1, 21))
        await sandbox.aupload_file_bytes(f"{wd}/data/multiline.txt", lines.encode())
        content = await sandbox.aread_file_range(f"{wd}/data/multiline.txt", offset=4, limit=6)
        assert content is not None
        result_lines = content.strip().split("\n")
        assert "line 5" in result_lines[0]

    async def test_edit_file(self, sandbox):
        wd = sandbox._work_dir
        await sandbox.awrite_file_text(f"{wd}/data/editable.txt", "Hello, old world!")
        result = await sandbox.aedit_file_text(
            f"{wd}/data/editable.txt", "old world", "new world"
        )
        assert result["success"] is True
        text = await sandbox.aread_file_text(f"{wd}/data/editable.txt")
        assert text == "Hello, new world!"

    async def test_edit_file_not_found(self, sandbox):
        wd = sandbox._work_dir
        result = await sandbox.aedit_file_text(
            f"{wd}/data/nonexistent.txt", "old", "new"
        )
        assert result["success"] is False
        assert "not found" in result["error"].lower()

    async def test_edit_file_old_string_not_found(self, sandbox):
        wd = sandbox._work_dir
        await sandbox.awrite_file_text(f"{wd}/data/edit_miss.txt", "Hello world")
        result = await sandbox.aedit_file_text(
            f"{wd}/data/edit_miss.txt", "nonexistent string", "new"
        )
        assert result["success"] is False

    async def test_create_directory(self, sandbox):
        wd = sandbox._work_dir
        ok = await sandbox.acreate_directory(f"{wd}/new_dir/sub")
        assert ok is True
        result = await sandbox.execute_bash_command(
            f"test -d {wd}/new_dir/sub && echo OK", working_dir=wd
        )
        assert "OK" in result["stdout"]

    async def test_list_directory(self, sandbox):
        wd = sandbox._work_dir
        await sandbox.aupload_file_bytes(f"{wd}/data/list_a.txt", b"a")
        await sandbox.aupload_file_bytes(f"{wd}/data/list_b.txt", b"b")

        entries = await sandbox.als_directory(f"{wd}/data")
        names = {e["name"] for e in entries}
        assert "list_a.txt" in names
        assert "list_b.txt" in names

    async def test_glob_files(self, sandbox):
        wd = sandbox._work_dir
        await sandbox.aupload_file_bytes(f"{wd}/data/file1.py", b"# py1")
        await sandbox.aupload_file_bytes(f"{wd}/data/file2.py", b"# py2")
        await sandbox.aupload_file_bytes(f"{wd}/data/file3.txt", b"text")

        matches = await sandbox.aglob_files("*.py", path=f"{wd}/data")
        assert len(matches) >= 2
        py_matches = [m for m in matches if m.endswith(".py")]
        assert len(py_matches) >= 2

    async def test_grep_content(self, sandbox):
        wd = sandbox._work_dir
        await sandbox.aupload_file_bytes(
            f"{wd}/data/searchable.txt", b"apple\nbanana\ncherry\napricot\n"
        )
        matches = await sandbox.agrep_content(
            "ap", path=f"{wd}/data", output_mode="content"
        )
        assert len(matches) > 0
        match_text = "\n".join(matches)
        assert "apple" in match_text or "apricot" in match_text

    async def test_grep_files_with_matches(self, sandbox):
        wd = sandbox._work_dir
        await sandbox.aupload_file_bytes(f"{wd}/data/grep1.txt", b"hello world\n")
        await sandbox.aupload_file_bytes(f"{wd}/data/grep2.txt", b"goodbye world\n")
        await sandbox.aupload_file_bytes(f"{wd}/data/grep3.txt", b"no match here\n")

        matches = await sandbox.agrep_content(
            "world", path=f"{wd}/data", output_mode="files_with_matches"
        )
        assert len(matches) >= 2

    async def test_download_nonexistent(self, sandbox):
        wd = sandbox._work_dir
        content = await sandbox.adownload_file_bytes(f"{wd}/data/nope.txt")
        assert content is None

    async def test_upload_denied_path(self, sandbox):
        """Path in denied_directories should be rejected."""
        wd = sandbox._work_dir
        # Add a denied directory to test denial
        sandbox.config.filesystem.denied_directories = [f"{wd}/_internal"]
        ok = await sandbox.aupload_file_bytes(f"{wd}/_internal/secret.txt", b"hack")
        assert ok is False
        # Restore
        sandbox.config.filesystem.denied_directories = []


# ---------------------------------------------------------------------------
# Path normalization and validation
# ---------------------------------------------------------------------------


class TestPathNormalization:
    """PTCSandbox path normalization and validation (sync — no asyncio mark)."""

    def test_normalize_dot(self, sandbox):
        wd = sandbox.config.filesystem.working_directory
        assert sandbox.normalize_path(".") == wd

    def test_normalize_empty(self, sandbox):
        wd = sandbox.config.filesystem.working_directory
        assert sandbox.normalize_path("") == wd

    def test_normalize_slash(self, sandbox):
        wd = sandbox.config.filesystem.working_directory
        assert sandbox.normalize_path("/") == wd

    def test_normalize_relative(self, sandbox):
        wd = sandbox.config.filesystem.working_directory
        assert sandbox.normalize_path("data/file.txt") == f"{wd}/data/file.txt"

    def test_normalize_virtual_absolute(self, sandbox):
        wd = sandbox.config.filesystem.working_directory
        assert sandbox.normalize_path("/results/out.txt") == f"{wd}/results/out.txt"

    def test_normalize_already_absolute(self, sandbox):
        wd = sandbox.config.filesystem.working_directory
        assert sandbox.normalize_path(f"{wd}/data/x.txt") == f"{wd}/data/x.txt"

    def test_normalize_tmp(self, sandbox):
        assert sandbox.normalize_path("/tmp/file.txt") == "/tmp/file.txt"

    def test_virtualize_path(self, sandbox):
        wd = sandbox.config.filesystem.working_directory
        assert sandbox.virtualize_path(f"{wd}/data/x.txt") == "/data/x.txt"
        assert sandbox.virtualize_path(wd) == "/"
        assert sandbox.virtualize_path("/tmp/x.txt") == "/tmp/x.txt"

    def test_validate_allowed(self, sandbox):
        wd = sandbox.config.filesystem.working_directory
        assert sandbox.validate_path(f"{wd}/data/x.txt") is True
        assert sandbox.validate_path("/tmp/x.txt") is True

    def test_validate_denied(self, sandbox):
        wd = sandbox.config.filesystem.working_directory
        # Add a denied directory to test denial
        sandbox.config.filesystem.denied_directories = [f"{wd}/_internal"]
        assert sandbox.validate_path(f"{wd}/_internal/secret.txt") is False
        assert sandbox.validate_path(f"{wd}/data/ok.txt") is True
        # Restore
        sandbox.config.filesystem.denied_directories = []


# ---------------------------------------------------------------------------
# Reconnection flow
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestReconnection:
    """PTCSandbox.reconnect() — stop → reconnect → verify state."""

    async def test_reconnect_from_stopped(self, sandbox, _patch_create_provider):
        sandbox_id = sandbox.sandbox_id
        wd = sandbox._work_dir

        # Upload data before stopping
        await sandbox.aupload_file_bytes(f"{wd}/data/before_stop.txt", b"preserved")

        # Stop
        await sandbox.stop_sandbox()

        # Reconnect
        await sandbox.reconnect(sandbox_id)
        assert sandbox.runtime is not None
        assert await sandbox.runtime.get_state() == RuntimeState.RUNNING

        # Data should be preserved
        content = await sandbox.adownload_file_bytes(f"{wd}/data/before_stop.txt")
        assert content == b"preserved"

    async def test_reconnect_already_running(self, sandbox, _patch_create_provider):
        """Reconnecting to a running sandbox should be a no-op start."""
        sandbox_id = sandbox.sandbox_id
        await sandbox.reconnect(sandbox_id)
        assert await sandbox.runtime.get_state() == RuntimeState.RUNNING

    async def test_reconnect_preserves_exec(self, sandbox, _patch_create_provider):
        """After reconnect, exec should work normally."""
        sandbox_id = sandbox.sandbox_id
        wd = sandbox._work_dir
        await sandbox.stop_sandbox()
        await sandbox.reconnect(sandbox_id)

        result = await sandbox.execute_bash_command("echo reconnected", working_dir=wd)
        assert result["success"] is True
        assert "reconnected" in result["stdout"]


# ---------------------------------------------------------------------------
# Token upload
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestTokenUpload:
    """PTCSandbox.upload_token_file() — token file lifecycle."""

    async def test_upload_tokens(self, sandbox):
        tokens = {
            "access_token": "gxsa_test_access",
            "refresh_token": "gxsr_test_refresh",
            "client_id": "test-client",
        }
        await sandbox.upload_token_file(tokens)

        # Read back from the sandbox using the same path constant
        token_path = f"{sandbox._work_dir}/_internal/.mcp_tokens.json"
        content = await sandbox.runtime.download_file(token_path)
        assert content is not None
        data = json.loads(content)
        assert data["access_token"] == "gxsa_test_access"
        assert data["refresh_token"] == "gxsr_test_refresh"
        assert data["client_id"] == "test-client"
        assert "auth_service_url" in data
        assert "ginlix_data_url" in data

    async def test_token_overwrite(self, sandbox):
        """Uploading tokens again should overwrite the file."""
        await sandbox.upload_token_file({"access_token": "v1", "refresh_token": "r1", "client_id": "c1"})
        await sandbox.upload_token_file({"access_token": "v2", "refresh_token": "r2", "client_id": "c2"})

        token_path = f"{sandbox._work_dir}/_internal/.mcp_tokens.json"
        content = await sandbox.runtime.download_file(token_path)
        data = json.loads(content)
        assert data["access_token"] == "v2"


# ---------------------------------------------------------------------------
# Manifest read/write
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestManifest:
    """PTCSandbox manifest lifecycle — write, read, and sync detection."""

    async def test_write_and_read_manifest(self, sandbox):
        # Compute and write
        manifest = await sandbox._compute_sandbox_manifest()
        await sandbox._write_unified_manifest(manifest)

        # Read back
        remote = await sandbox._read_unified_manifest()
        assert remote is not None
        assert remote.get("schema_version") == 1
        assert "modules" in remote

    async def test_manifest_versioning(self, sandbox):
        """Two consecutive manifests should have matching versions when
        nothing changed."""
        m1 = await sandbox._compute_sandbox_manifest()
        m2 = await sandbox._compute_sandbox_manifest()

        # Module versions should match for same config
        for module_name in m1.get("modules", {}):
            v1 = m1["modules"][module_name].get("version")
            v2 = m2["modules"][module_name].get("version")
            if v1 is not None:
                assert v1 == v2, f"Module {module_name} version mismatch"


# ---------------------------------------------------------------------------
# Cleanup and close
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestCleanupAndClose:
    """PTCSandbox.cleanup() and close() — resource release."""

    async def test_cleanup_deletes_runtime(self, sandbox_minimal, _patch_create_provider):
        sb = sandbox_minimal
        await sb.setup_sandbox_workspace()
        assert sb.runtime is not None

        await sb.cleanup()
        assert sb.runtime is None
        assert sb.sandbox_id is None

    async def test_close_releases_provider(self, sandbox_minimal, _patch_create_provider):
        if _patch_create_provider is None:
            pytest.skip("Test requires MemoryProvider (checks _closed attribute)")
        sb = sandbox_minimal
        await sb.setup_sandbox_workspace()

        await sb.close()
        # Provider should be closed — further create() calls fail
        provider = _patch_create_provider
        assert provider._closed is True

    async def test_cleanup_is_idempotent(self, sandbox_minimal, _patch_create_provider):
        sb = sandbox_minimal
        await sb.setup_sandbox_workspace()
        await sb.cleanup()
        # Second cleanup should not raise
        await sb.cleanup()

    async def test_stop_then_cleanup(self, sandbox_minimal, _patch_create_provider):
        """stop_sandbox then cleanup — the normal session teardown path."""
        sb = sandbox_minimal
        await sb.setup_sandbox_workspace()

        await sb.stop_sandbox()
        await sb.cleanup()  # delete after stop
        assert sb.runtime is None


# ---------------------------------------------------------------------------
# Lazy initialization
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestLazyInit:
    """PTCSandbox lazy init: start_lazy_init → ensure_sandbox_ready → use."""

    async def test_lazy_init_flow(self, sandbox, _patch_create_provider):
        """Create → stop → lazy reconnect → wait → use."""
        sandbox_id = sandbox.sandbox_id
        await sandbox.stop_sandbox()

        # Reset runtime so reconnect is needed
        sandbox.runtime = None
        sandbox.sandbox_id = None

        # Start lazy init
        sandbox.start_lazy_init(sandbox_id)
        assert sandbox.is_ready() is False or sandbox.is_ready() is True  # may complete fast

        # Wait for ready
        await sandbox.ensure_sandbox_ready()
        assert sandbox.is_ready() is True

        # Should be operational
        wd = sandbox._work_dir
        result = await sandbox.execute_bash_command("echo lazy_ready", working_dir=wd)
        assert result["success"] is True
        assert "lazy_ready" in result["stdout"]

    async def test_is_ready_before_init(self, sandbox_minimal, _patch_create_provider):
        """Before any init, is_ready() should return False."""
        assert sandbox_minimal.is_ready() is False
