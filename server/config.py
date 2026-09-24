"""Environment + auth configuration for the ASMPT Intelligent Factory app.

Works in two modes:
  - Deployed on Databricks Apps: service principal creds auto-injected
    (DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET / DATABRICKS_HOST).
  - Local dev: uses a CLI profile (DATABRICKS_CONFIG_PROFILE).
"""
import os

CATALOG = os.getenv("ASMPT_CATALOG", "dante_classic_stable_catalog")
GOLD = f"{CATALOG}.asmpt_gold"
SILVER = f"{CATALOG}.asmpt_silver"

# SQL warehouse id (serverless). Provided via app.yaml valueFrom -> resource,
# falls back to the known demo warehouse for local dev.
WAREHOUSE_ID = os.getenv("DATABRICKS_WAREHOUSE_ID", "114b2f7bfa1273b1")

# Model artifacts live in a UC Volume (readable by the app service principal
# once granted READ VOLUME). Local dev can point at a downloaded copy.
MODEL_DIR = os.getenv(
    "ASMPT_MODEL_DIR",
    "/Volumes/dante_classic_stable_catalog/asmpt_gold/models",
)

IS_DATABRICKS_APP = bool(os.getenv("DATABRICKS_CLIENT_ID"))


from functools import lru_cache


@lru_cache(maxsize=1)
def get_config():
    """Return a cached databricks.sdk Config that authenticates in either mode.

    Cached as a singleton so the SDK's in-process token cache is reused across
    concurrent requests instead of re-authenticating on every connection.
    """
    from databricks.sdk.core import Config

    if IS_DATABRICKS_APP:
        return Config()  # service principal from injected env
    profile = os.getenv("DATABRICKS_CONFIG_PROFILE", "fevm-dante-classic-stable")
    return Config(profile=profile)
