import logging
from typing import Any, Dict, Optional
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Custom application exception with structured error code, message, and optional fields."""

    def __init__(
        self,
        code: str,
        message: str,
        fields: Optional[Dict[str, Any]] = None,
        status_code: int = 400,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.fields = fields
        self.status_code = status_code


HTTP_STATUS_CODE_MAP = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "TOO_MANY_REQUESTS",
    500: "INTERNAL_ERROR",
}


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    content = {
        "error": {
            "code": exc.code,
            "message": exc.message,
            "fields": exc.fields,
        }
    }
    return JSONResponse(status_code=exc.status_code, content=content)


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    fields: Dict[str, Any] = {}
    for err in exc.errors():
        loc = [str(part) for part in err.get("loc", []) if str(part) != "body"]
        field_name = ".".join(loc) if loc else "body"
        fields[field_name] = err.get("msg", "Invalid value")

    content = {
        "error": {
            "code": "VALIDATION_ERROR",
            "message": "Validation error",
            "fields": fields,
        }
    }
    return JSONResponse(status_code=422, content=content)


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    code = HTTP_STATUS_CODE_MAP.get(exc.status_code, "HTTP_ERROR")
    message = str(exc.detail) if exc.detail else "An HTTP error occurred"
    content = {
        "error": {
            "code": code,
            "message": message,
            "fields": None,
        }
    }
    return JSONResponse(status_code=exc.status_code, content=content)


async def unhandled_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    content = {
        "error": {
            "code": "INTERNAL_ERROR",
            "message": "An internal server error occurred",
            "fields": None,
        }
    }
    return JSONResponse(status_code=500, content=content)


class UnhandledErrorMiddleware:
    """Turns an unexpected exception into the standard INTERNAL_ERROR JSON response.

    Starlette runs the catch-all Exception handler outside every other middleware, so its response
    skipped CORS and the browser reported "can't reach the server" instead of the error. Added before
    CORSMiddleware, this sits inside it, so error responses carry CORS headers too."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        response_started = False

        async def tracking_send(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception:
            logger.exception("Unhandled error on %s %s", scope.get("method"), scope.get("path"))
            if response_started:
                raise  # too late to send a different response
            response = JSONResponse(
                status_code=500,
                content={"error": {"code": "INTERNAL_ERROR", "message": "An internal server error occurred", "fields": None}},
            )
            await response(scope, receive, send)


def register_error_handlers(app: FastAPI) -> None:
    """Registers all custom exception handlers on a FastAPI application instance.
    Call before adding CORSMiddleware (see UnhandledErrorMiddleware)."""
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.add_middleware(UnhandledErrorMiddleware)
