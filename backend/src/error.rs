use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub(crate) enum ApiError {
    #[error("not authenticated")]
    Unauthenticated,
    #[error("room is not allowed: {0}")]
    RoomNotAllowed(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    NotFound(String),
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("internal error")]
    Internal,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            ApiError::Unauthenticated => (
                StatusCode::UNAUTHORIZED,
                "UNAUTHENTICATED",
                "authentication required".to_string(),
            ),
            ApiError::RoomNotAllowed(_) => {
                (StatusCode::FORBIDDEN, "ROOM_NOT_ALLOWED", self.to_string())
            }
            ApiError::Forbidden(_) => (StatusCode::FORBIDDEN, "FORBIDDEN", self.to_string()),
            ApiError::Conflict(_) => (StatusCode::CONFLICT, "CONFLICT", self.to_string()),
            ApiError::NotFound(_) => (StatusCode::NOT_FOUND, "NOT_FOUND", self.to_string()),
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", self.to_string()),
            ApiError::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL",
                "unexpected server error".to_string(),
            ),
        };

        (
            status,
            Json(serde_json::json!({
                "error": {
                    "code": code,
                    "message": message,
                }
            })),
        )
            .into_response()
    }
}
