"""Release entry point for the embedded Atlas FastAPI server."""

import os

import uvicorn

from api import app


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("ATLAS_PORT", "8000")),
        log_level="warning",
    )
