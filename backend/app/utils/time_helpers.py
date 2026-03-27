"""Time / date helper utilities."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


def parse_date(s: str, end_of_day: bool = False) -> datetime:
    """Parse an ISO date string (YYYY-MM-DD) to a timezone-aware datetime (UTC).

    If end_of_day=True, returns 23:59:59.999999 on that day to include
    all intraday bars.
    """
    dt = datetime.strptime(s, "%Y-%m-%d")
    if end_of_day:
        dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
    return dt.replace(tzinfo=timezone.utc)


def to_iso_date(dt: datetime) -> str:
    """Format a datetime to YYYY-MM-DD string."""
    return dt.strftime("%Y-%m-%d")


def to_iso_datetime(dt: datetime) -> str:
    """Format a datetime to ISO-8601 string."""
    return dt.isoformat()


def next_business_days(from_date: datetime, n: int) -> list[datetime]:
    """Return next *n* business days starting from (and excluding) *from_date*."""
    days: list[datetime] = []
    current = from_date
    while len(days) < n:
        current += timedelta(days=1)
        if current.weekday() < 5:  # Mon-Fri
            days.append(current)
    return days


def next_hours(from_date: datetime, n: int, step_hours: int = 1) -> list[datetime]:
    """Return next *n* time steps advancing by *step_hours* each time."""
    return [from_date + timedelta(hours=step_hours * (i + 1)) for i in range(n)]


