"""Shared Azure OpenAI client factory — chooses managed-identity (Entra AAD) or API-key auth.

Managed identity is used when AZURE_OPENAI_USE_MANAGED_IDENTITY is truthy, OR when an
endpoint is configured but NO API key is available (key-less / disableLocalAuth resources
such as a customer's existing PTU deployment). The Web App's system-assigned identity must
hold the "Cognitive Services OpenAI User" role on the target Azure OpenAI resource.

Auth precedence:
  1. AZURE_OPENAI_USE_MANAGED_IDENTITY = true/1/yes/on  -> managed identity (ignore key)
  2. AZURE_OPENAI_USE_MANAGED_IDENTITY = false/0/no/off -> API key
  3. unset -> API key when a key is present, else managed identity (auto)
"""
import os
import re

_COGNITIVE_SCOPE = "https://cognitiveservices.azure.com/.default"


def normalise_endpoint(endpoint: str) -> str:
    """Strip any /openai/... path — the SDK appends it automatically — and ensure one trailing slash."""
    return re.sub(r"/openai/.*$", "", (endpoint or "").rstrip("/")) + "/"


def use_managed_identity(api_key: str = "") -> bool:
    """Return True when the Azure OpenAI client should authenticate with the managed identity."""
    flag = (os.getenv("AZURE_OPENAI_USE_MANAGED_IDENTITY", "") or "").strip().lower()
    if flag in ("1", "true", "yes", "on"):
        return True
    if flag in ("0", "false", "no", "off"):
        return False
    return not bool((api_key or "").strip())  # auto: managed identity only when no key is set


def credentials_ready(endpoint: str, api_key: str = "") -> bool:
    """True when Azure OpenAI is usable: an endpoint plus either a key or managed identity."""
    if not (endpoint or "").strip():
        return False
    return bool((api_key or "").strip()) or use_managed_identity(api_key)


def build_client(endpoint: str, api_key: str = "", api_version: str = "2024-10-21"):
    """Build an AzureOpenAI client using managed identity or an API key per the precedence above."""
    from openai import AzureOpenAI
    endpoint = normalise_endpoint(endpoint)
    if use_managed_identity(api_key):
        from azure.identity import DefaultAzureCredential, get_bearer_token_provider
        token_provider = get_bearer_token_provider(DefaultAzureCredential(), _COGNITIVE_SCOPE)
        return AzureOpenAI(
            azure_endpoint=endpoint,
            api_version=api_version,
            azure_ad_token_provider=token_provider,
        )
    return AzureOpenAI(azure_endpoint=endpoint, api_key=api_key, api_version=api_version)
