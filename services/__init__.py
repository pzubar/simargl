"""Services package for Simargl."""

from .batch_service import BatchJobService, BatchModeUnavailableError

__all__ = ["BatchJobService", "BatchModeUnavailableError"]
