"""Integration tests for SandboxRuntime lifecycle — provider-agnostic.

Tests the full runtime lifecycle: create → start → exec/code_run → file I/O →
stop → start (reconnect) → archive → start (unarchive) → delete.

These tests use the `sandbox_runtime` and `sandbox_provider` fixtures from
conftest.py, which select the backend based on SANDBOX_TEST_PROVIDER env var.
Every sandbox created is deleted on teardown.
"""

from __future__ import annotations

import pytest

from ptc_agent.core.sandbox.runtime import (
    CodeRunResult,
    ExecResult,
    RuntimeState,
    SandboxTransientError,
)

from .memory_provider import MemoryProvider

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


# ---------------------------------------------------------------------------
# Provider lifecycle (memory-only — close/get semantics are memory-specific)
# ---------------------------------------------------------------------------


class TestProviderLifecycle:
    """SandboxProvider.create / get / close contract (memory provider)."""

    async def test_create_returns_running_runtime(self, sandbox_provider):
        runtime = await sandbox_provider.create(env_vars={"KEY": "val"})
        try:
            assert runtime.id is not None
            assert len(runtime.id) > 0
            state = await runtime.get_state()
            assert state == RuntimeState.RUNNING
        finally:
            await runtime.delete()

    async def test_create_unique_ids(self, sandbox_provider):
        r1 = await sandbox_provider.create()
        r2 = await sandbox_provider.create()
        try:
            assert r1.id != r2.id
        finally:
            await r1.delete()
            await r2.delete()

    async def test_get_returns_same_runtime(self, sandbox_provider):
        created = await sandbox_provider.create()
        try:
            retrieved = await sandbox_provider.get(created.id)
            assert retrieved.id == created.id
        finally:
            await created.delete()

    async def test_env_vars_passed_to_runtime(self, sandbox_provider):
        runtime = await sandbox_provider.create(env_vars={"MY_KEY": "my_val"})
        try:
            result = await runtime.exec("echo $MY_KEY")
            assert "my_val" in result.stdout
        finally:
            await runtime.delete()


# ---------------------------------------------------------------------------
# Runtime state machine
# ---------------------------------------------------------------------------


class TestRuntimeStateMachine:
    """Full state machine: running → stopped → running → deleted."""

    async def test_initial_state_is_running(self, sandbox_runtime):
        assert await sandbox_runtime.get_state() == RuntimeState.RUNNING

    async def test_stop_transitions_to_stopped(self, sandbox_runtime):
        await sandbox_runtime.stop()
        assert await sandbox_runtime.get_state() == RuntimeState.STOPPED

    async def test_start_from_stopped(self, sandbox_runtime):
        await sandbox_runtime.stop()
        await sandbox_runtime.start()
        assert await sandbox_runtime.get_state() == RuntimeState.RUNNING

    async def test_start_when_already_running_is_noop(self, sandbox_runtime):
        await sandbox_runtime.start()
        assert await sandbox_runtime.get_state() == RuntimeState.RUNNING

    async def test_full_stop_start_cycle(self, sandbox_runtime):
        """running → stop → start → stop → start"""
        assert await sandbox_runtime.get_state() == RuntimeState.RUNNING

        await sandbox_runtime.stop()
        assert await sandbox_runtime.get_state() == RuntimeState.STOPPED

        await sandbox_runtime.start()
        assert await sandbox_runtime.get_state() == RuntimeState.RUNNING

        await sandbox_runtime.stop()
        assert await sandbox_runtime.get_state() == RuntimeState.STOPPED

        await sandbox_runtime.start()
        assert await sandbox_runtime.get_state() == RuntimeState.RUNNING


# ---------------------------------------------------------------------------
# Exec
# ---------------------------------------------------------------------------


class TestRuntimeExec:
    """SandboxRuntime.exec() — shell command execution."""

    async def test_simple_command(self, sandbox_runtime):
        result = await sandbox_runtime.exec("echo hello")
        assert isinstance(result, ExecResult)
        assert result.exit_code == 0
        assert "hello" in result.stdout

    async def test_exit_code_nonzero(self, sandbox_runtime):
        result = await sandbox_runtime.exec("exit 42")
        assert result.exit_code == 42

    async def test_command_with_env_var(self, sandbox_runtime):
        result = await sandbox_runtime.exec("echo $TEST_VAR")
        assert "hello" in result.stdout

    async def test_multiline_output(self, sandbox_runtime):
        result = await sandbox_runtime.exec("echo line1 && echo line2 && echo line3")
        lines = result.stdout.strip().split("\n")
        assert len(lines) == 3

    async def test_exec_on_stopped_runtime_raises(self, sandbox_runtime):
        await sandbox_runtime.stop()
        with pytest.raises(Exception):  # DaytonaError, RuntimeError, or SandboxTransientError
            await sandbox_runtime.exec("echo hello")
        # Restart for cleanup
        await sandbox_runtime.start()

    async def test_mkdir_and_ls(self, sandbox_runtime):
        await sandbox_runtime.exec("mkdir -p testdir/sub")
        result = await sandbox_runtime.exec("ls testdir")
        assert "sub" in result.stdout

    async def test_pipe_commands(self, sandbox_runtime):
        result = await sandbox_runtime.exec("echo 'a b c' | wc -w")
        assert "3" in result.stdout


# ---------------------------------------------------------------------------
# Code run
# ---------------------------------------------------------------------------


class TestRuntimeCodeRun:
    """SandboxRuntime.code_run() — Python code execution."""

    async def test_simple_python(self, sandbox_runtime):
        result = await sandbox_runtime.code_run("print(2 + 2)")
        assert isinstance(result, CodeRunResult)
        assert result.exit_code == 0
        assert "4" in result.stdout

    async def test_python_with_env(self, sandbox_runtime):
        result = await sandbox_runtime.code_run(
            "import os; print(os.environ.get('CUSTOM_VAR', 'missing'))",
            env={"CUSTOM_VAR": "injected"},
        )
        assert "injected" in result.stdout

    async def test_python_error(self, sandbox_runtime):
        result = await sandbox_runtime.code_run("raise ValueError('test error')")
        assert result.exit_code != 0
        assert "ValueError" in result.stderr or "ValueError" in result.stdout

    async def test_python_imports(self, sandbox_runtime):
        result = await sandbox_runtime.code_run(
            "import json; print(json.dumps({'key': 'value'}))"
        )
        assert result.exit_code == 0
        assert '"key"' in result.stdout

    async def test_python_file_creation(self, sandbox_runtime):
        """Code can create files in the working directory."""
        wd = await sandbox_runtime.fetch_working_dir()
        await sandbox_runtime.code_run(
            f"with open('{wd}/output.txt', 'w') as f: f.write('hello from python')"
        )
        content = await sandbox_runtime.download_file(f"{wd}/output.txt")
        assert content == b"hello from python"

    async def test_python_multiline(self, sandbox_runtime):
        code = """\
data = [1, 2, 3, 4, 5]
total = sum(data)
avg = total / len(data)
print(f"sum={total}, avg={avg}")
"""
        result = await sandbox_runtime.code_run(code)
        assert result.exit_code == 0
        assert "sum=15" in result.stdout
        assert "avg=3.0" in result.stdout

    async def test_code_run_on_stopped_runtime_raises(self, sandbox_runtime):
        await sandbox_runtime.stop()
        with pytest.raises(Exception):  # DaytonaError, RuntimeError, or SandboxTransientError
            await sandbox_runtime.code_run("print('hello')")
        await sandbox_runtime.start()


# ---------------------------------------------------------------------------
# File I/O
# ---------------------------------------------------------------------------


class TestRuntimeFileIO:
    """SandboxRuntime file operations: upload, download, list, batch upload."""

    async def test_upload_and_download(self, sandbox_runtime):
        wd = await sandbox_runtime.fetch_working_dir()
        content = b"Hello, sandbox!"
        await sandbox_runtime.upload_file(content, f"{wd}/test.txt")
        downloaded = await sandbox_runtime.download_file(f"{wd}/test.txt")
        assert downloaded == content

    async def test_upload_creates_parent_dirs(self, sandbox_runtime):
        wd = await sandbox_runtime.fetch_working_dir()
        await sandbox_runtime.upload_file(b"nested", f"{wd}/a/b/c/deep.txt")
        content = await sandbox_runtime.download_file(f"{wd}/a/b/c/deep.txt")
        assert content == b"nested"

    async def test_download_nonexistent_raises(self, sandbox_runtime):
        wd = await sandbox_runtime.fetch_working_dir()
        with pytest.raises((FileNotFoundError, Exception)):
            await sandbox_runtime.download_file(f"{wd}/nonexistent_xyz.txt")

    async def test_upload_overwrite(self, sandbox_runtime):
        wd = await sandbox_runtime.fetch_working_dir()
        await sandbox_runtime.upload_file(b"version1", f"{wd}/data.txt")
        await sandbox_runtime.upload_file(b"version2", f"{wd}/data.txt")
        content = await sandbox_runtime.download_file(f"{wd}/data.txt")
        assert content == b"version2"

    async def test_upload_binary(self, sandbox_runtime):
        wd = await sandbox_runtime.fetch_working_dir()
        binary_data = bytes(range(256))
        await sandbox_runtime.upload_file(binary_data, f"{wd}/binary.bin")
        downloaded = await sandbox_runtime.download_file(f"{wd}/binary.bin")
        assert downloaded == binary_data

    async def test_upload_files_batch(self, sandbox_runtime):
        wd = await sandbox_runtime.fetch_working_dir()
        files = [
            (b"content_a", f"{wd}/batch/a.txt"),
            (b"content_b", f"{wd}/batch/b.txt"),
            (b"content_c", f"{wd}/batch/c.txt"),
        ]
        await sandbox_runtime.upload_files(files)

        for content, path in files:
            downloaded = await sandbox_runtime.download_file(path)
            assert downloaded == content

    async def test_list_files(self, sandbox_runtime):
        wd = await sandbox_runtime.fetch_working_dir()
        await sandbox_runtime.upload_file(b"a", f"{wd}/listdir/file1.txt")
        await sandbox_runtime.upload_file(b"b", f"{wd}/listdir/file2.txt")
        await sandbox_runtime.exec(f"mkdir -p {wd}/listdir/subdir")

        entries = await sandbox_runtime.list_files(f"{wd}/listdir")

        def _get_name(e):
            """Extract name from entry — handles both dict and object."""
            if isinstance(e, dict):
                return e.get("name", "")
            return getattr(e, "name", str(e))

        names = {_get_name(e) for e in entries}
        assert "file1.txt" in names
        assert "file2.txt" in names
        assert "subdir" in names

    async def test_file_io_on_stopped_runtime_raises(self, sandbox_runtime):
        wd = await sandbox_runtime.fetch_working_dir()
        await sandbox_runtime.stop()
        with pytest.raises(Exception):  # DaytonaError, RuntimeError, or SandboxTransientError
            await sandbox_runtime.upload_file(b"data", f"{wd}/test.txt")
        await sandbox_runtime.start()

    async def test_large_file(self, sandbox_runtime):
        """Test file I/O with a 1MB file."""
        wd = await sandbox_runtime.fetch_working_dir()
        large_content = b"x" * (1024 * 1024)
        await sandbox_runtime.upload_file(large_content, f"{wd}/large.bin")
        downloaded = await sandbox_runtime.download_file(f"{wd}/large.bin")
        assert len(downloaded) == len(large_content)
        assert downloaded == large_content


# ---------------------------------------------------------------------------
# Metadata & Capabilities
# ---------------------------------------------------------------------------


class TestRuntimeMetadata:
    """SandboxRuntime.capabilities, get_metadata(), working_dir, fetch_working_dir."""

    async def test_capabilities_set(self, sandbox_runtime):
        caps = sandbox_runtime.capabilities
        assert isinstance(caps, set)
        assert "exec" in caps
        assert "code_run" in caps
        assert "file_io" in caps

    async def test_get_metadata(self, sandbox_runtime):
        meta = await sandbox_runtime.get_metadata()
        assert meta["id"] == sandbox_runtime.id
        assert "working_dir" in meta

    async def test_working_dir_property(self, sandbox_runtime):
        wd = sandbox_runtime.working_dir
        assert wd is not None
        assert len(wd) > 0

    async def test_fetch_working_dir(self, sandbox_runtime):
        wd = await sandbox_runtime.fetch_working_dir()
        assert wd == sandbox_runtime.working_dir


# ---------------------------------------------------------------------------
# Data persistence across stop/start cycles
# ---------------------------------------------------------------------------


class TestDataPersistenceAcrossCycles:
    """Verify files survive stop → start cycles (provider contract)."""

    async def test_files_persist_across_stop_start(self, sandbox_runtime):
        wd = await sandbox_runtime.fetch_working_dir()
        await sandbox_runtime.upload_file(b"persistent data", f"{wd}/persist.txt")

        await sandbox_runtime.stop()
        await sandbox_runtime.start()

        content = await sandbox_runtime.download_file(f"{wd}/persist.txt")
        assert content == b"persistent data"

    async def test_code_run_output_files_persist(self, sandbox_runtime):
        wd = await sandbox_runtime.fetch_working_dir()
        await sandbox_runtime.code_run(
            f"with open('{wd}/code_file.txt', 'w') as f: f.write('from code_run')"
        )

        await sandbox_runtime.stop()
        await sandbox_runtime.start()

        content = await sandbox_runtime.download_file(f"{wd}/code_file.txt")
        assert content == b"from code_run"

    async def test_multiple_stop_start_cycles(self, sandbox_runtime):
        wd = await sandbox_runtime.fetch_working_dir()
        await sandbox_runtime.upload_file(b"cycle_data", f"{wd}/cycle.txt")

        for i in range(3):
            await sandbox_runtime.stop()
            await sandbox_runtime.start()
            content = await sandbox_runtime.download_file(f"{wd}/cycle.txt")
            assert content == b"cycle_data", f"Failed on cycle {i}"


# ---------------------------------------------------------------------------
# Full lifecycle integration (memory-only — uses provider.get + archive)
# ---------------------------------------------------------------------------


class TestFullLifecycle:
    """End-to-end lifecycle: create → use → stop → reconnect → use → delete.

    Uses sandbox_provider so it runs against whichever provider is configured.
    """

    async def test_complete_lifecycle(self, sandbox_provider):
        # 1. Create
        runtime = await sandbox_provider.create(
            env_vars={"APP_ENV": "test", "API_KEY": "secret123"}
        )
        try:
            assert await runtime.get_state() == RuntimeState.RUNNING
            wd = await runtime.fetch_working_dir()

            # 2. Setup workspace structure
            await runtime.exec(f"mkdir -p {wd}/sandbox_tools {wd}/data {wd}/results")

            # 3. Upload tool files
            tool_code = b"def get_price(symbol): return 42.0\n"
            await runtime.upload_file(tool_code, f"{wd}/sandbox_tools/market.py")
            await runtime.upload_file(b"", f"{wd}/sandbox_tools/__init__.py")

            # 4. Execute code using the tool
            result = await runtime.code_run(
                "from sandbox_tools.market import get_price; "
                "print(f'AAPL: ${get_price(\"AAPL\")}')",
                env={"PYTHONPATH": wd},
            )
            assert result.exit_code == 0
            assert "AAPL: $42.0" in result.stdout

            # 5. Bash command with env var
            bash_result = await runtime.exec("echo API_KEY=$API_KEY")
            assert "secret123" in bash_result.stdout

            # 6. Upload and process data
            await runtime.upload_file(
                b"col1,col2\n1,2\n3,4\n", f"{wd}/data/input.csv"
            )
            result = await runtime.code_run(
                f"import csv\n"
                f"with open('{wd}/data/input.csv') as f:\n"
                f"    rows = list(csv.DictReader(f))\n"
                f"print(f'Rows: {{len(rows)}}')\n"
            )
            assert result.exit_code == 0
            assert "Rows: 2" in result.stdout

            # 7. Generate output
            await runtime.code_run(
                f"with open('{wd}/results/output.txt', 'w') as f: "
                f"f.write('Analysis complete\\n')"
            )
            output = await runtime.download_file(f"{wd}/results/output.txt")
            assert b"Analysis complete" in output

            # 8. Stop
            await runtime.stop()
            assert await runtime.get_state() == RuntimeState.STOPPED

            # 9. Reconnect via provider.get
            reconnected = await sandbox_provider.get(runtime.id)
            await reconnected.start()
            assert await reconnected.get_state() == RuntimeState.RUNNING

            # 10. Verify data survived
            output = await reconnected.download_file(f"{wd}/results/output.txt")
            assert b"Analysis complete" in output

            # 11. More work after reconnect
            result = await reconnected.exec(f"cat {wd}/data/input.csv | wc -l")
            assert "3" in result.stdout

        finally:
            # 12. ALWAYS delete — prevents resource leaks on real providers
            try:
                await runtime.delete()
            except Exception:
                pass
