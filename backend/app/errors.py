from typing import Any, Dict, Optional
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


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


def register_error_handlers(app: FastAPI) -> None:
    """Registers all custom exception handlers on a FastAPI application instance."""
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
