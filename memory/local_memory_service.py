import logging
from typing import Iterable
from channel_registry import get_channel_registry
from memory.channel_memory_service import ChannelMemoryItem # Використаємо існуючу модель даних

logger = logging.getLogger(__name__)

class LocalMemoryService:
    """Локальна реалізація сервісу пам'яті, що пише у 'notes' в registry.json."""

    def __init__(self):
        self._registry = get_channel_registry()
        logger.info("LocalMemoryService (JSON file) увімкнено.")

    def enabled(self) -> bool:
        return True

    def remember(self, items: Iterable[ChannelMemoryItem]) -> bool:
        """Зберігає факти, дописуючи їх у поле 'notes' каналу."""
        try:
            for item in items:
                record = self._registry.get(item.channel_id)
                if not record:
                    continue

                new_fact = f"[MEMORY_FACT from {item.source or 'agent'}]: {item.fact}"

                # Додаємо новий факт до існуючих нотаток
                current_notes = record.notes or ""
                updated_notes = f"{current_notes}\n{new_fact}".strip()

                self._registry.update_partial(item.channel_id, notes=updated_notes)
            return True
        except Exception as e:
            logger.error(f"Помилка при збереженні локальної пам'яті: {e}")
            return False

    def recall(self, channel_id: str, query: str) -> list[str]:
        """
        Симулює 'recall'. Просто повертає всі нотатки, оскільки локальний
        JSON не підтримує семантичний пошук.
        """
        record = self._registry.get(channel_id)
        if record and record.notes:
            # Повертаємо всі нотатки як один "спогад"
            return [record.notes]
        return []

__all__ = ["LocalMemoryService"]