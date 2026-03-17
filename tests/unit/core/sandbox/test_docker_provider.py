"""Unit tests for DockerRuntime and DockerProvider with mocked aiodocker.

Covers:
- DockerRuntime state mapping (_DOCKER_STATE_MAP)
- DockerRuntime exec: mock container.exec(), verify ExecResult
- DockerRuntime lifecycle: start/stop/delete delegate to container methods
- DockerRuntime capabilities: no "archive", no "snapshot"
- DockerRuntime archive: raises NotImplementedError
- DockerRuntime tar upload/download: mock container.put_archive/get_archive
- DockerRuntime bind upload/download: use tmp_path for real filesystem
- DockerProvider create: mock aiodocker.Docker client
- DockerProvider create with bind-mount: verify host_config includes Binds
- DockerProvider get: mock container lookup
- DockerProvider close: verify client is closed
- DockerProvider is_transient_error: test classification
- _parse_memory helper: test conversions
"""

from __future__ import annotations

import io
import tarfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ptc_agent.config.core import DockerConfig
from ptc_agent.core.sandbox.providers.docker import (
    DockerProvider,
    DockerRuntime,
    _DOCKER_STATE_MAP,
    _parse_memory,
)
from ptc_agent.core.sandbox.runtime import (
    ExecResult,
    RuntimeState,
    SandboxTransientError,
)


# ---------------------------------------------------------------------------
# Helpers for building mock aiodocker objects
# ---------------------------------------------------------------------------


def _make_mock_container(
    *,
    status: str = "running",
    container_id: str = "abc123",
    mounts: list | None = None,
) -> MagicMock:
    """Build a mock aiodocker DockerContainer."""
    container = MagicMock()
    container.start = AsyncMock()
    container.stop = AsyncMock()
    container.delete = AsyncMock()
    container.put_archive = AsyncMock()

    # show() returns container info dict
    container_info = {
        "State": {"Status": status},
        "Id": container_id,
        "Config": {"WorkingDir": "/home/workspace", "Env": []},
        "Mounts": mounts or [],
    }
    container._container = container_info
    container.show = AsyncMock(return_value=container_info)

    return container


def _make_exec_mock(output: str = "", exit_code: int = 0) -> MagicMock:
    """Build a mock exec object matching the aiodocker exec API."""
    msg = MagicMock()
    msg.data = output.encode("utf-8")

    stream = AsyncMock()
    stream.read_out = AsyncMock(side_effect=[msg, None])

    exec_obj = MagicMock()
    # exec_obj.start() returns an async context manager
    ctx_mgr = AsyncMock()
    ctx_mgr.__aenter__ = AsyncMock(return_value=stream)
    ctx_mgr.__aexit__ = AsyncMock(return_value=False)
    exec_obj.start = MagicMock(return_value=ctx_mgr)
    exec_obj.inspect = AsyncMock(return_value={"ExitCode": exit_code})

    return exec_obj


# ---------------------------------------------------------------------------
# _parse_memory helper
# ---------------------------------------------------------------------------


class TestParseMemory:
    def test_bytes_plain(self):
        assert _parse_memory("1024") == 1024

    def test_kilobytes(self):
        assert _parse_memory("1k") == 1024

    def test_kilobytes_with_b(self):
        assert _parse_memory("1kb") == 1024

    def test_megabytes(self):
        assert _parse_memory("512m") == 512 * 1024**2

    def test_megabytes_with_b(self):
        assert _parse_memory("512mb") == 512 * 1024**2

    def test_gigabytes(self):
        assert _parse_memory("4g") == 4 * 1024**3

    def test_gigabytes_with_b(self):
        assert _parse_memory("4gb") == 4 * 1024**3

    def test_terabytes(self):
        assert _parse_memory("1t") == 1024**4

    def test_fractional(self):
        assert _parse_memory("1.5g") == int(1.5 * 1024**3)

    def test_with_whitespace(self):
        assert _parse_memory("  4g  ") == 4 * 1024**3

    def test_uppercase_is_lowered(self):
        assert _parse_memory("4G") == 4 * 1024**3

    def test_invalid_raises(self):
        with pytest.raises(ValueError, match="Cannot parse memory limit"):
            _parse_memory("not_a_number")


# ---------------------------------------------------------------------------
# DockerRuntime — state mapping
# ---------------------------------------------------------------------------


class TestDockerRuntimeStateMapping:
    """Verify _DOCKER_STATE_MAP covers expected Docker statuses."""

    def test_running_maps_to_running(self):
        assert _DOCKER_STATE_MAP["running"] == RuntimeState.RUNNING

    def test_created_maps_to_stopped(self):
        assert _DOCKER_STATE_MAP["created"] == RuntimeState.STOPPED

    def test_exited_maps_to_stopped(self):
        assert _DOCKER_STATE_MAP["exited"] == RuntimeState.STOPPED

    def test_paused_maps_to_stopped(self):
        assert _DOCKER_STATE_MAP["paused"] == RuntimeState.STOPPED

    def test_dead_maps_to_error(self):
        assert _DOCKER_STATE_MAP["dead"] == RuntimeState.ERROR

    def test_restarting_maps_to_starting(self):
        assert _DOCKER_STATE_MAP["restarting"] == RuntimeState.STARTING

    def test_removing_maps_to_stopping(self):
        assert _DOCKER_STATE_MAP["removing"] == RuntimeState.STOPPING


# ---------------------------------------------------------------------------
# DockerRuntime — properties and lifecycle
# ---------------------------------------------------------------------------


class TestDockerRuntimeProperties:
    @pytest.fixture
    def container(self):
        return _make_mock_container()

    @pytest.fixture
    def runtime(self, container):
        return DockerRuntime(
            container,
            runtime_id="docker-test123",
            working_dir="/home/workspace",
        )

    def test_id_property(self, runtime):
        assert runtime.id == "docker-test123"

    def test_working_dir_property(self, runtime):
        assert runtime.working_dir == "/home/workspace"

    @pytest.mark.asyncio
    async def test_fetch_working_dir(self, runtime):
        result = await runtime.fetch_working_dir()
        assert result == "/home/workspace"

    def test_capabilities_no_archive(self, runtime):
        caps = runtime.capabilities
        assert "exec" in caps
        assert "code_run" in caps
        assert "file_io" in caps
        assert "archive" not in caps
        assert "snapshot" not in caps

    @pytest.mark.asyncio
    async def test_archive_raises_not_implemented(self, runtime):
        with pytest.raises(NotImplementedError, match="does not support archive"):
            await runtime.archive()

    @pytest.mark.asyncio
    async def test_get_metadata(self, runtime):
        meta = await runtime.get_metadata()
        assert meta["id"] == "docker-test123"
        assert meta["working_dir"] == "/home/workspace"
        assert meta["provider"] == "docker"
        assert meta["dev_mode"] is False
        assert "state" in meta
        assert meta["state"] in {s.value for s in RuntimeState}


class TestDockerRuntimeLifecycle:
    @pytest.fixture
    def container(self):
        return _make_mock_container()

    @pytest.fixture
    def runtime(self, container):
        return DockerRuntime(
            container,
            runtime_id="docker-lc",
            working_dir="/home/workspace",
        )

    @pytest.mark.asyncio
    async def test_start_delegates(self, runtime, container):
        await runtime.start()
        container.start.assert_called_once()

    @pytest.mark.asyncio
    async def test_stop_delegates(self, runtime, container):
        await runtime.stop(timeout=30)
        container.stop.assert_called_once_with(t=30)

    @pytest.mark.asyncio
    async def test_delete_stops_then_force_deletes(self, runtime, container):
        await runtime.delete()
        container.stop.assert_called_once_with(t=5)
        container.delete.assert_called_once_with(force=True)

    @pytest.mark.asyncio
    async def test_delete_ignores_stop_error(self, runtime, container):
        """delete() should still force-remove even if stop() fails."""
        container.stop.side_effect = Exception("already stopped")
        await runtime.delete()
        container.delete.assert_called_once_with(force=True)

    @pytest.mark.asyncio
    async def test_get_state_running(self, runtime, container):
        container._container = {"State": {"Status": "running"}}
        state = await runtime.get_state()
        assert state == RuntimeState.RUNNING
        container.show.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_state_exited(self, runtime, container):
        container.show = AsyncMock(return_value={"State": {"Status": "exited"}})
        state = await runtime.get_state()
        assert state == RuntimeState.STOPPED

    @pytest.mark.asyncio
    async def test_get_state_unknown_defaults_to_error(self, runtime, container):
        container.show = AsyncMock(return_value={"State": {"Status": "something_weird"}})
        state = await runtime.get_state()
        assert state == RuntimeState.ERROR


# ---------------------------------------------------------------------------
# DockerRuntime — exec
# ---------------------------------------------------------------------------


class TestDockerRuntimeExec:
    @pytest.fixture
    def container(self):
        return _make_mock_container()

    @pytest.fixture
    def runtime(self, container):
        return DockerRuntime(
            container,
            runtime_id="docker-exec",
            working_dir="/home/workspace",
        )

    @pytest.mark.asyncio
    async def test_exec_returns_result(self, runtime, container):
        exec_mock = _make_exec_mock("hello world\n", exit_code=0)
        container.exec = AsyncMock(return_value=exec_mock)

        result = await runtime.exec("echo hello world")
        assert isinstance(result, ExecResult)
        assert result.stdout == "hello world\n"
        assert result.exit_code == 0
        assert result.stderr == ""

    @pytest.mark.asyncio
    async def test_exec_passes_workdir(self, runtime, container):
        exec_mock = _make_exec_mock("", exit_code=0)
        container.exec = AsyncMock(return_value=exec_mock)

        await runtime.exec("ls")
        container.exec.assert_called_once_with(
            cmd=["bash", "-c", "ls"],
            workdir="/home/workspace",
        )

    @pytest.mark.asyncio
    async def test_exec_nonzero_exit_code(self, runtime, container):
        exec_mock = _make_exec_mock("", exit_code=1)
        container.exec = AsyncMock(return_value=exec_mock)

        result = await runtime.exec("false")
        assert result.exit_code == 1

    @pytest.mark.asyncio
    async def test_exec_timeout_returns_error(self, runtime, container):
        import asyncio

        container.exec = AsyncMock(side_effect=asyncio.TimeoutError())
        result = await runtime.exec("sleep 999")
        assert result.exit_code == -1
        assert result.stderr == "timeout"

    @pytest.mark.asyncio
    async def test_exec_container_gone_raises_transient(self, runtime, container):
        container.exec = AsyncMock(
            side_effect=Exception("no such container: abc123")
        )
        with pytest.raises(SandboxTransientError):
            await runtime.exec("echo hi")

    @pytest.mark.asyncio
    async def test_exec_generic_error_returns_error_result(self, runtime, container):
        container.exec = AsyncMock(
            side_effect=Exception("something unexpected")
        )
        result = await runtime.exec("echo hi")
        assert result.exit_code == -1
        assert "something unexpected" in result.stderr


# ---------------------------------------------------------------------------
# DockerRuntime — tar upload
# ---------------------------------------------------------------------------


class TestDockerRuntimeTarUpload:
    @pytest.fixture
    def container(self):
        c = _make_mock_container()
        # exec is needed for mkdir -p in _tar_upload
        exec_mock = _make_exec_mock("", exit_code=0)
        c.exec = AsyncMock(return_value=exec_mock)
        return c

    @pytest.fixture
    def runtime(self, container):
        return DockerRuntime(
            container,
            runtime_id="docker-tar-up",
            working_dir="/home/workspace",
            dev_mode=False,
        )

    @pytest.mark.asyncio
    async def test_upload_calls_put_archive(self, runtime, container):
        await runtime.upload_file(b"file content", "/home/workspace/test.txt")
        container.put_archive.assert_called_once()

        # Verify put_archive is called with root "/" and full path in tar entry
        call_args = container.put_archive.call_args
        assert call_args[0][0] == "/"

        # Verify the second arg is valid tar data with full path as entry name
        tar_data = call_args[0][1]
        assert isinstance(tar_data, bytes)
        with tarfile.open(fileobj=io.BytesIO(tar_data), mode="r") as tar:
            members = tar.getmembers()
            assert len(members) == 1
            assert members[0].name == "home/workspace/test.txt"
            f = tar.extractfile(members[0])
            assert f.read() == b"file content"

    @pytest.mark.asyncio
    async def test_upload_creates_parent_dir(self, runtime, container):
        """_tar_upload should exec mkdir -p for the parent directory."""
        await runtime.upload_file(b"data", "/home/workspace/subdir/file.txt")
        # The exec call is for mkdir
        container.exec.assert_called()


# ---------------------------------------------------------------------------
# DockerRuntime — tar download
# ---------------------------------------------------------------------------


class TestDockerRuntimeDownload:
    @pytest.fixture
    def container(self):
        return _make_mock_container()

    @pytest.fixture
    def runtime(self, container):
        return DockerRuntime(
            container,
            runtime_id="docker-download",
            working_dir="/home/workspace",
            dev_mode=False,
        )

    @pytest.mark.asyncio
    async def test_download_via_exec_base64(self, runtime, container):
        """download_file uses exec + base64 to read files."""
        import base64 as b64

        content = b"downloaded content"
        encoded = b64.b64encode(content).decode() + "\n"

        exec_mock = _make_exec_mock(output=encoded, exit_code=0)
        container.exec = AsyncMock(return_value=exec_mock)

        result = await runtime.download_file("/home/workspace/file.txt")
        assert result == content

    @pytest.mark.asyncio
    async def test_download_file_not_found(self, runtime, container):
        """download_file raises FileNotFoundError for missing files."""
        exec_mock = _make_exec_mock(output="", exit_code=1)
        container.exec = AsyncMock(return_value=exec_mock)

        with pytest.raises(FileNotFoundError):
            await runtime.download_file("/home/workspace/missing.txt")


# ---------------------------------------------------------------------------
# DockerRuntime — bind-mount upload/download
# ---------------------------------------------------------------------------


class TestDockerRuntimeBindMount:
    @pytest.fixture
    def container(self):
        return _make_mock_container()

    @pytest.fixture
    def runtime(self, container, tmp_path):
        host_dir = str(tmp_path / "sandbox_work")
        return DockerRuntime(
            container,
            runtime_id="docker-bind",
            working_dir="/home/workspace",
            dev_mode=True,
            host_work_dir=host_dir,
        )

    @pytest.mark.asyncio
    async def test_upload_writes_to_host_fs(self, runtime, tmp_path):
        await runtime.upload_file(b"hello bind", "/home/workspace/test.txt")
        host_file = tmp_path / "sandbox_work" / "test.txt"
        assert host_file.exists()
        assert host_file.read_bytes() == b"hello bind"

    @pytest.mark.asyncio
    async def test_upload_creates_subdirs(self, runtime, tmp_path):
        await runtime.upload_file(b"nested", "/home/workspace/a/b/file.txt")
        host_file = tmp_path / "sandbox_work" / "a" / "b" / "file.txt"
        assert host_file.exists()
        assert host_file.read_bytes() == b"nested"

    @pytest.mark.asyncio
    async def test_download_reads_from_host_fs(self, runtime, tmp_path):
        host_dir = tmp_path / "sandbox_work"
        host_dir.mkdir(parents=True, exist_ok=True)
        (host_dir / "read_me.txt").write_bytes(b"read this")

        data = await runtime.download_file("/home/workspace/read_me.txt")
        assert data == b"read this"

    @pytest.mark.asyncio
    async def test_download_not_found_raises(self, runtime):
        with pytest.raises(FileNotFoundError):
            await runtime.download_file("/home/workspace/does_not_exist.txt")

    @pytest.mark.asyncio
    async def test_bind_mode_does_not_call_put_archive(self, runtime, container):
        """In bind mode, upload should NOT use the Docker tar API."""
        await runtime.upload_file(b"data", "/home/workspace/x.txt")
        container.put_archive.assert_not_called()


# ---------------------------------------------------------------------------
# DockerProvider
# ---------------------------------------------------------------------------


class TestDockerProvider:
    @pytest.fixture
    def mock_client(self):
        client = MagicMock()
        # containers.create returns a DockerContainer directly
        mock_container = _make_mock_container(container_id="container-id-abc")
        client.containers.create = AsyncMock(return_value=mock_container)
        # containers.get returns a DockerContainer for reconnecting
        client.containers.get = AsyncMock(return_value=mock_container)

        # images.inspect (for _ensure_image)
        client.images.inspect = AsyncMock()

        client.close = AsyncMock()
        return client

    @pytest.fixture
    def provider(self, mock_client):
        p = DockerProvider.__new__(DockerProvider)
        p._config = DockerConfig(image="test-sandbox:latest")
        p._working_dir = "/home/workspace"
        p._client = mock_client
        return p

    @pytest.mark.asyncio
    async def test_create_returns_docker_runtime(self, provider, mock_client):
        runtime = await provider.create(env_vars={"FOO": "bar"})
        assert isinstance(runtime, DockerRuntime)
        mock_client.containers.create.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_starts_container(self, provider, mock_client):
        """create() should call container.start() after creation."""
        runtime = await provider.create()
        mock_container = mock_client.containers.create.return_value
        mock_container.start.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_config_includes_image(self, provider, mock_client):
        await provider.create()
        call_kwargs = mock_client.containers.create.call_args
        config = call_kwargs.kwargs.get("config") or call_kwargs[1].get("config")
        assert config["Image"] == "test-sandbox:latest"

    @pytest.mark.asyncio
    async def test_create_config_includes_env_vars(self, provider, mock_client):
        await provider.create(env_vars={"MY_VAR": "value1", "OTHER": "value2"})
        call_kwargs = mock_client.containers.create.call_args
        config = call_kwargs.kwargs.get("config") or call_kwargs[1].get("config")
        env = config.get("Env", [])
        assert "MY_VAR=value1" in env
        assert "OTHER=value2" in env

    @pytest.mark.asyncio
    async def test_create_no_env_vars_omits_env(self, provider, mock_client):
        await provider.create()
        call_kwargs = mock_client.containers.create.call_args
        config = call_kwargs.kwargs.get("config") or call_kwargs[1].get("config")
        assert "Env" not in config

    @pytest.mark.asyncio
    async def test_create_with_bind_mount(self, mock_client, tmp_path):
        """When dev_mode=True and host_work_dir is set, Binds should appear in host config."""
        host_dir = str(tmp_path / "host_sandbox")
        p = DockerProvider.__new__(DockerProvider)
        p._config = DockerConfig(
            image="test-sandbox:latest",
            dev_mode=True,
            host_work_dir=host_dir,
        )
        p._working_dir = "/home/workspace"
        p._client = mock_client

        await p.create()
        call_kwargs = mock_client.containers.create.call_args
        config = call_kwargs.kwargs.get("config") or call_kwargs[1].get("config")
        host_config = config["HostConfig"]
        assert "Binds" in host_config
        assert any("/home/workspace" in b for b in host_config["Binds"])

    @pytest.mark.asyncio
    async def test_create_without_bind_mount_no_binds(self, provider, mock_client):
        """Default (non-dev) mode should not include Binds."""
        await provider.create()
        call_kwargs = mock_client.containers.create.call_args
        config = call_kwargs.kwargs.get("config") or call_kwargs[1].get("config")
        host_config = config["HostConfig"]
        assert "Binds" not in host_config

    @pytest.mark.asyncio
    async def test_create_installs_mcp_packages(self, provider, mock_client):
        """create() should run npm install -g for each MCP package."""
        mock_container = mock_client.containers.create.return_value
        exec_mock = _make_exec_mock("added 1 package\n", exit_code=0)
        mock_container.exec = AsyncMock(return_value=exec_mock)

        runtime = await provider.create(mcp_packages=["@tavily/mcp-server"])
        assert isinstance(runtime, DockerRuntime)

        # Verify exec was called with npm install -g containing the package
        mock_container.exec.assert_called_once()
        call_args = mock_container.exec.call_args
        cmd = call_args.kwargs.get("cmd") or call_args[1].get("cmd") or call_args[0]
        # cmd is ["bash", "-c", "npm install -g @tavily/mcp-server"]
        assert cmd[0] == "bash"
        assert "npm install -g" in cmd[2]
        assert "@tavily/mcp-server" in cmd[2]

    @pytest.mark.asyncio
    async def test_create_empty_mcp_packages_skips_install(self, provider, mock_client):
        """create() should not call exec when mcp_packages is empty or None."""
        mock_container = mock_client.containers.create.return_value

        # Test with empty list
        await provider.create(mcp_packages=[])
        mock_container.exec.assert_not_called()

        mock_container.exec.reset_mock()

        # Test with None (default)
        await provider.create(mcp_packages=None)
        mock_container.exec.assert_not_called()

    @pytest.mark.asyncio
    async def test_get_returns_runtime(self, provider, mock_client):
        mock_container = mock_client.containers.get.return_value
        mock_container.show = AsyncMock(return_value={
            "State": {"Status": "running"},
            "Config": {"WorkingDir": "/home/workspace", "Env": []},
            "Mounts": [],
        })
        runtime = await provider.get("docker-abc123")
        assert isinstance(runtime, DockerRuntime)
        assert runtime.id == "docker-abc123"

    @pytest.mark.asyncio
    async def test_get_detects_bind_mount(self, provider, mock_client):
        """get() should detect dev_mode from existing bind mounts."""
        mock_container = mock_client.containers.get.return_value
        mock_container.show = AsyncMock(return_value={
            "State": {"Status": "running"},
            "Config": {"WorkingDir": "/home/workspace", "Env": []},
            "Mounts": [
                {
                    "Destination": "/home/workspace",
                    "Source": "/host/path/work",
                    "Type": "bind",
                }
            ],
        })
        runtime = await provider.get("docker-xyz")
        assert runtime._dev_mode is True
        assert runtime._host_work_dir == "/host/path/work"

    @pytest.mark.asyncio
    async def test_get_container_not_found_raises(self, provider, mock_client):
        mock_client.containers.get = AsyncMock(side_effect=Exception("404 not found"))
        with pytest.raises(RuntimeError, match="Docker container not found"):
            await provider.get("nonexistent")

    @pytest.mark.asyncio
    async def test_close_closes_client(self, provider, mock_client):
        await provider.close()
        mock_client.close.assert_called_once()
        assert provider._client is None

    @pytest.mark.asyncio
    async def test_close_idempotent(self, provider, mock_client):
        """Closing twice should not error."""
        await provider.close()
        await provider.close()  # should be no-op since _client is None

    @pytest.mark.asyncio
    async def test_close_handles_client_error(self, mock_client):
        """close() should not raise even if the client fails."""
        mock_client.close = AsyncMock(side_effect=Exception("connection lost"))
        p = DockerProvider.__new__(DockerProvider)
        p._config = DockerConfig()
        p._client = mock_client
        await p.close()  # should not raise
        assert p._client is None


class TestDockerProviderTransientErrors:
    @pytest.fixture
    def provider(self):
        p = DockerProvider.__new__(DockerProvider)
        p._config = DockerConfig()
        p._client = None
        return p

    def test_connection_refused(self, provider):
        assert provider.is_transient_error(Exception("connection refused"))

    def test_connection_reset(self, provider):
        assert provider.is_transient_error(Exception("connection reset"))

    def test_connection_aborted(self, provider):
        assert provider.is_transient_error(Exception("connection aborted"))

    def test_broken_pipe(self, provider):
        assert provider.is_transient_error(Exception("broken pipe"))

    def test_timed_out(self, provider):
        assert provider.is_transient_error(Exception("timed out"))

    def test_timeout(self, provider):
        assert provider.is_transient_error(Exception("timeout"))

    def test_non_transient_value_error(self, provider):
        assert not provider.is_transient_error(ValueError("bad argument"))

    def test_non_transient_generic(self, provider):
        assert not provider.is_transient_error(Exception("file not found"))

    def test_case_insensitive(self, provider):
        assert provider.is_transient_error(Exception("Connection Refused"))


# ---------------------------------------------------------------------------
# DockerProvider — lazy client creation
# ---------------------------------------------------------------------------


class TestDockerProviderLazyClient:
    @pytest.mark.asyncio
    async def test_get_client_creates_lazily(self):
        """_get_client() should import and create aiodocker.Docker on first call."""
        p = DockerProvider(DockerConfig())
        assert p._client is None

        mock_docker_cls = MagicMock()
        mock_docker_instance = MagicMock()
        mock_docker_cls.return_value = mock_docker_instance

        # aiodocker is imported lazily inside _get_client via `import aiodocker`,
        # so we patch it in sys.modules before the call.
        mock_mod = MagicMock()
        mock_mod.Docker = mock_docker_cls
        with patch.dict("sys.modules", {"aiodocker": mock_mod}):
            client = await p._get_client()

        assert client is mock_docker_instance
        assert p._client is mock_docker_instance
