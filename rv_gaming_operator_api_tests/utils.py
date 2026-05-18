import os
import sys
import datetime
import configparser
import uuid
import random


def log(msg):
    """Log a message with timestamp."""
    now = datetime.datetime.now()
    print(f"{now}\t{msg}")


def error(msg):
    """Log an error and exit."""
    log(f"ERROR: {msg}")
    sys.exit(1)


def warning(msg):
    """Log a warning."""
    log(f"WARNING: {msg}")


def random_uuid():
    """Generate a random UUID string."""
    return str(uuid.uuid4())


def random_bet_id():
    """Generate a random large integer for bet IDs."""
    return random.randint(100000000000000000, 999999999999999999)


def random_round_id():
    """Generate a random round ID integer."""
    return random.randint(10000, 99999)


def to_decimal(value):
    """Convert a value to Decimal for precise comparison."""
    from decimal import Decimal

    return Decimal(str(value))


class TestFailure(Exception):
    """Raised when a test assertion fails."""

    pass


def test_assert(condition, message):
    """Assert a condition; raise TestFailure if false."""
    if not condition:
        raise TestFailure(message)


class Config:
    """Read and store configuration from an INI file."""

    def __init__(self, filename):
        if not os.path.exists(filename):
            error(f"Config file '{filename}' not found")

        config = configparser.ConfigParser()
        config.read(filename)

        section = "wallet"
        self.wallet_base_url = config.get(section, "wallet_base_url").rstrip("/")
        self.api_key = config.get(section, "api_key")
        self.player_session_token = config.get(section, "player_session_token")
        self.player_session_token_expired = config.get(
            section, "player_session_token_expired"
        )
        self.player_id = config.get(section, "player_id")
        self.agent_id = int(config.get(section, "agent_id"))
        self.game_id = int(config.get(section, "game_id"))
        self.game_name = config.get(section, "game_name")
        self.game_type = config.get(section, "game_type")
        self.currency = config.get(section, "currency")
        self.amount = config.get(section, "amount")

        # Error testing
        self.api_key_invalid = config.get(section, "api_key_invalid", fallback="InvalidApiKey")
        self.amount_insufficient_funds = config.get(
            section, "amount_insufficient_funds", fallback="9999999"
        )
        self.blocked_player_id = config.get(section, "blocked_player_id", fallback="")
        self.blocked_player_session_token = config.get(
            section, "blocked_player_session_token", fallback=""
        )
