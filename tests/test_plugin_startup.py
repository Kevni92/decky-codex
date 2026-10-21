"""Exercise the actual Decky entry point, including frozen-stdlib failures."""
import asyncio
import builtins
import importlib.util
import logging
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]


def load_plugin():
    spec = importlib.util.spec_from_file_location('_decky_startup_test', ROOT / 'main.py')
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'decky': SimpleNamespace(emit=AsyncMock(), logger=logging.getLogger('startup-test'))}):
        spec.loader.exec_module(module)
    return module.Plugin()


class StartupTests(unittest.IsolatedAsyncioTestCase):
    async def test_entry_point_survives_missing_frozen_stdlib_module(self):
        # Decky's executable is frozen: Python stdlib on the host does not imply
        # a module is included in its embedded interpreter. Reproduce missing pty.
        code = r'''
import asyncio, builtins, importlib.util, logging, os, sys, tempfile
from types import SimpleNamespace
from unittest.mock import AsyncMock
original_import = builtins.__import__
def frozen_import(name, *args, **kwargs):
    if name in ('pty', 'tty'):
        raise ModuleNotFoundError("No module named '" + name + "'")
    return original_import(name, *args, **kwargs)
builtins.__import__ = frozen_import
sys.modules['decky'] = SimpleNamespace(emit=AsyncMock(), logger=logging.getLogger('frozen-test'))
spec = importlib.util.spec_from_file_location('_', 'main.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
async def run():
    with tempfile.TemporaryDirectory() as directory:
        os.environ['DECKY_USER_HOME'] = directory
        os.environ['DECKY_PLUGIN_RUNTIME_DIR'] = directory + '/data'
        plugin = module.Plugin()
        await plugin._main()
        try:
            reply = await plugin.dispatch('snapshot', {})
            assert reply['ok'] and reply['state']['version']
        finally:
            await plugin._unload()
asyncio.run(run())
'''
        result = await asyncio.to_thread(subprocess.run, [sys.executable, '-c', code], cwd=ROOT, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    async def test_import_error_is_returned_through_live_rpc(self):
        plugin = load_plugin()
        original_import = builtins.__import__
        def missing(name, *args, **kwargs):
            if name == 'backend.service':
                raise ModuleNotFoundError("No module named 'example_missing_module'")
            return original_import(name, *args, **kwargs)
        with patch('builtins.__import__', side_effect=missing), self.assertLogs('startup-test', level='ERROR'):
            await plugin._main()
        with self.assertRaisesRegex(RuntimeError, 'example_missing_module'):
            await plugin.dispatch('snapshot', {})
        await plugin._unload()

    async def test_initialization_failure_is_reported_and_unload_safe(self):
        plugin = load_plugin()
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'DECKY_USER_HOME': directory, 'DECKY_PLUGIN_RUNTIME_DIR': directory + '/data'}):
            with patch('backend.service.Service._install_agent_context', side_effect=OSError('Test: agent context unavailable')), self.assertLogs('startup-test', level='ERROR'):
                await plugin._main()
            with self.assertRaisesRegex(RuntimeError, 'agent context unavailable'):
                await plugin.dispatch('snapshot', {})
            await plugin._unload()

    async def test_rpc_waits_until_initialization_completes(self):
        plugin = load_plugin()
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'DECKY_USER_HOME': directory, 'DECKY_PLUGIN_RUNTIME_DIR': directory + '/data'}):
            request = asyncio.create_task(plugin.dispatch('snapshot', {}))
            await asyncio.sleep(0)
            self.assertFalse(request.done())
            await plugin._main()
            try:
                self.assertTrue((await request)['ok'])
            finally:
                await plugin._unload()
