import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from dotenv import load_dotenv
from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session, make_transient_to_detached

from app.db import get_db
from app.errors import AppError
from app.models import User, UserRole

# Load environment variables
load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise ValueError("JWT_SECRET environment variable is missing from .env file.")

JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))
ALGORITHM = "HS256"

# Password hashing context (bcrypt)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Bearer security scheme
security = HTTPBearer(auto_error=False)

# Router
router = APIRouter(prefix="/auth", tags=["auth"])


# --- Schemas ---
class LoginRequest(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    team: Optional[str] = None


class LoginResponse(BaseModel):
    access_token: str
    user: UserResponse


# --- Utility Functions ---
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain text password against its bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Generates a bcrypt hash for a plain text password."""
    return pwd_context.hash(password)


def create_access_token(user: User, expires_delta: Optional[timedelta] = None) -> str:
    """Creates a JWT access token containing user sub, role, and name."""
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta is not None else timedelta(minutes=JWT_EXPIRE_MINUTES)
    )
    payload: Dict[str, Any] = {
        "sub": str(user.id),
        "role": role_val,
        "name": user.name,
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


# --- Dependencies ---
async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency to extract and validate JWT bearer token and retrieve the user."""
    if not credentials or not credentials.credentials:
        raise AppError(
            code="UNAUTHORIZED",
            message="Missing or invalid authorization token",
            status_code=401,
        )

    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        user_id: Optional[str] = payload.get("sub")
        if not user_id:
            raise AppError(
                code="UNAUTHORIZED",
                message="Invalid token payload",
                status_code=401,
            )
    except JWTError:
        raise AppError(
            code="UNAUTHORIZED",
            message="Invalid or expired access token",
            status_code=401,
        )

    cached = _user_cache.get(user_id)
    if cached and time.monotonic() - cached[0] < USER_CACHE_SECONDS:
        # Attach the cached copy to this session without querying
        return db.merge(_detached_copy(cached[1]), load=False)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise AppError(
            code="UNAUTHORIZED",
            message="User not found",
            status_code=401,
        )

    _user_cache[user_id] = (time.monotonic(), _detached_copy(user))
    return user


# Every authenticated request needs the user; caching it briefly saves a database round trip per request.
# Role or team changes take effect within this many seconds.
USER_CACHE_SECONDS = 60
_user_cache: Dict[str, Tuple[float, User]] = {}


def _detached_copy(user: User) -> User:
    copy = User(
        id=user.id,
        name=user.name,
        email=user.email,
        password_hash=user.password_hash,
        role=user.role,
        team=user.team,
    )
    make_transient_to_detached(copy)
    return copy


def require_role(*roles: Any):
    """Dependency factory restricting access to users with specified roles."""
    allowed_roles = [r.value if hasattr(r, "value") else str(r) for r in roles]

    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        user_role_str = (
            current_user.role.value
            if hasattr(current_user.role, "value")
            else str(current_user.role)
        )
        if user_role_str not in allowed_roles:
            raise AppError(
                code="FORBIDDEN",
                message="Insufficient permissions to perform this action",
                status_code=403,
            )
        return current_user

    return role_checker


# --- Router Endpoints ---
@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate user with email and password and return access token."""
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise AppError(
            code="UNAUTHORIZED",
            message="Invalid email or password",
            status_code=401,
        )

    access_token = create_access_token(user)
    user_role_str = user.role.value if hasattr(user.role, "value") else str(user.role)
    return {
        "access_token": access_token,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user_role_str,
            "team": user.team,
        },
    }


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Get profile information for the currently authenticated user."""
    user_role_str = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else str(current_user.role)
    )
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "role": user_role_str,
        "team": current_user.team,
    }
