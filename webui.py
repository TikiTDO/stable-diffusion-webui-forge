from __future__ import annotations

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from modules import timer
from modules import initialize_util
from modules import initialize
from threading import Thread
from modules_forge.initialization import initialize_forge
from modules_forge import main_thread


startup_timer = timer.startup_timer
startup_timer.record("launcher")

initialize_forge()

initialize.imports()

initialize.check_versions()

initialize.initialize()


def _handle_exception(request: Request, e: Exception):
    error_information = vars(e)
    content = {
        "error": type(e).__name__,
        "detail": error_information.get("detail", ""),
        "body": error_information.get("body", ""),
        "message": str(e),
    }
    return JSONResponse(status_code=int(error_information.get("status_code", 500)), content=jsonable_encoder(content))


def create_api(app):
    from modules.api.api import Api
    from modules.call_queue import queue_lock

    api = Api(app, queue_lock)
    return api


def diffusatory_worker():
    import os
    from pathlib import Path

    from fastapi import FastAPI
    from modules.shared_cmd_options import cmd_opts
    from modules import progress, script_callbacks

    app = FastAPI(exception_handlers={Exception: _handle_exception})
    initialize_util.setup_middleware(app)
    api = create_api(app)

    progress.setup_progress_api(app)
    script_callbacks.before_ui_callback()
    script_callbacks.app_started_callback(None, app)

    from diffusatory.server.access import (
        install_diffusatory_access,
        read_api_token,
    )
    from diffusatory.server.mount import mount_diffusatory

    token_path = os.getenv("DIFFUSATORY_API_TOKEN_FILE")
    api_token = read_api_token(Path(token_path)) if token_path else None
    install_diffusatory_access(
        app,
        mode=cmd_opts.diffusatory_access,
        api_token=api_token,
        secure_cookie=bool(cmd_opts.tls_keyfile and cmd_opts.tls_certfile),
    )
    mount_diffusatory(app, serve_ui=cmd_opts.diffusatory_access != "api")

    print(f"Startup time: {startup_timer.summary()}.")
    api.launch(
        server_name=initialize_util.gradio_server_name() or "127.0.0.1",
        port=cmd_opts.port if cmd_opts.port else 7861,
        root_path=f"/{cmd_opts.subpath}" if cmd_opts.subpath else ""
    )


def diffusatory():
    Thread(target=diffusatory_worker, daemon=True).start()


if __name__ == "__main__":
    diffusatory()
    main_thread.loop()
