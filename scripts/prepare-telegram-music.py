"""Alias this bot's existing Local API music directory without exposing its token."""

from pathlib import Path
import re
import shlex
import sys


def prepare(root: Path) -> Path:
    token = None
    for line in (root / ".env").read_text().splitlines():
        key, separator, value = line.strip().removeprefix("export ").partition("=")
        if separator and key.strip() == "BOT_TOKEN":
            parts = shlex.split(value, comments=True)
            token = parts[0] if len(parts) == 1 else None
    if not token or not re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]+", token):
        raise RuntimeError("BOT_TOKEN is missing or invalid in the deployment .env.")

    api_data = (root / "data/telegram-api").resolve()
    target = api_data / token / "music"
    try:
        target.resolve().relative_to(api_data)
    except ValueError:
        raise RuntimeError("The bot music cache must remain inside Local API data.") from None
    if not target.is_dir():
        raise RuntimeError("Local API has no music cache for this bot yet.")

    alias = root / "data/telegram-music"
    if alias.is_symlink():
        if alias.resolve() != target.resolve():
            raise RuntimeError("The existing music alias points to a different directory.")
    elif alias.exists():
        raise RuntimeError("The music alias path is already occupied.")
    else:
        alias.symlink_to(Path("telegram-api") / token / "music", target_is_directory=True)
    return alias


if __name__ == "__main__":
    try:
        prepare(Path(__file__).resolve().parent.parent)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError):
        print("Unable to prepare the private Telegram music alias.", file=sys.stderr)
        sys.exit(1)
    print("Prepared private Telegram music alias.")
