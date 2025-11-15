"""Simargl Agent Package."""
import os
import sys
import certifi

# Explicitly add the virtual environment's site-packages to sys.path
# This is a workaround for ModuleNotFoundError issues.
virtual_env_path = os.getenv("VIRTUAL_ENV")
if virtual_env_path:
    site_packages_path = os.path.join(virtual_env_path, "lib", f"python{sys.version_info.major}.{sys.version_info.minor}", "site-packages")
    if os.path.exists(site_packages_path) and site_packages_path not in sys.path:
        sys.path.insert(0, site_packages_path)

os.environ["SSL_CERT_FILE"] = certifi.where()

from . import agent
