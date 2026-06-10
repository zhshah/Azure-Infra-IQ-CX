"""
Credential Store — Fernet-based encryption for stored passwords.
Key is derived from a machine-specific salt file + app secret.
Credentials are encrypted at rest in .env / settings.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import platform
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_SALT_FILE_NAME = ".optimizer_salt"
_fernet: Fernet | None = None


def _get_salt_path() -> Path:
    """Salt stored alongside app data directory."""
    settings_dir = os.getenv("SETTINGS_DIR", "")
    if settings_dir:
        return Path(settings_dir) / _SALT_FILE_NAME
    return Path(__file__).parent.parent / "data" / _SALT_FILE_NAME


def _get_or_create_salt() -> bytes:
    """Get existing salt or create a new one. Salt is persistent."""
    salt_path = _get_salt_path()
    salt_path.parent.mkdir(parents=True, exist_ok=True)
    if salt_path.exists():
        return salt_path.read_bytes()
    salt = os.urandom(32)
    salt_path.write_bytes(salt)
    try:
        import stat
        os.chmod(salt_path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    return salt


def _derive_key() -> bytes:
    """
    Derive Fernet key from:
    - Machine-specific salt (persisted)
    - Machine hostname (ties key to this machine)
    - App secret (optional env var for extra entropy)
    """
    salt = _get_or_create_salt()
    app_secret = os.getenv("OPTIMIZER_SECRET", "azure-cost-optimizer-v1")
    machine_id = platform.node()

    # PBKDF2 derivation
    key_material = f"{machine_id}:{app_secret}".encode()
    derived = hashlib.pbkdf2_hmac("sha256", key_material, salt, 100_000)
    return base64.urlsafe_b64encode(derived)


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_get_derive_key())
    return _fernet


def _get_derive_key() -> bytes:
    return _derive_key()


def encrypt(plaintext: str) -> str:
    """Encrypt a string. Returns base64-encoded ciphertext with 'enc:' prefix."""
    if not plaintext:
        return ""
    try:
        f = Fernet(_derive_key())
        token = f.encrypt(plaintext.encode("utf-8"))
        return "enc:" + token.decode("ascii")
    except Exception as e:
        logger.error("Encryption failed: %s", e)
        return ""


def decrypt(ciphertext: str) -> str:
    """Decrypt a string. If not encrypted (no 'enc:' prefix), returns as-is."""
    if not ciphertext:
        return ""
    if not ciphertext.startswith("enc:"):
        return ciphertext  # plaintext (legacy or not encrypted)
    try:
        f = Fernet(_derive_key())
        token = ciphertext[4:].encode("ascii")
        return f.decrypt(token).decode("utf-8")
    except InvalidToken:
        logger.warning("Failed to decrypt credential — key may have changed")
        return ""
    except Exception as e:
        logger.error("Decryption failed: %s", e)
        return ""


def is_encrypted(value: str) -> bool:
    """Check if a value is already encrypted."""
    return value.startswith("enc:") if value else False
