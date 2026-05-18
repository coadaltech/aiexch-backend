"""
Seamless Wallet API Client

Provides methods to call the operator's seamless wallet endpoints:
- GET  /accounts/balance/{player_id}
- POST /accounts/transactions/debit
- POST /accounts/transactions/credit
- POST /accounts/transactions/rollback

Response format for all successful calls:
    {"balance": "150.00", "version": 1767810946823}
"""

import json
import datetime
import urllib.request
import urllib.parse
import urllib.error
from decimal import Decimal

from utils import (
    Config,
    log,
    error,
    random_uuid,
    random_bet_id,
    to_decimal,
    test_assert,
    TestFailure,
)

# Sentinel object: when a parameter equals _DEFAULT the config value is used.
# Distinct from None which means "omit the header entirely".
_DEFAULT = object()


class SeamlessWallet:
    def __init__(self, config_filename):
        self.config = Config(config_filename)
        self._version = 0

    # ------------------------------------------
    # Internal helpers
    # ------------------------------------------

    def _next_version(self):
        self._version += 1
        return self._version

    def _build_balance_url(self, player_id):
        encoded = urllib.parse.quote(str(player_id), safe="")
        return f"{self.config.wallet_base_url}/accounts/balance/{encoded}"

    def _build_debit_url(self):
        return f"{self.config.wallet_base_url}/accounts/transactions/debit"

    def _build_credit_url(self):
        return f"{self.config.wallet_base_url}/accounts/transactions/credit"

    def _build_rollback_url(self):
        return f"{self.config.wallet_base_url}/accounts/transactions/rollback"

    def _build_headers(self, player_session_token=None, api_key=None):
        """
        Build HTTP headers.

        api_key=None  -> use config default
        api_key="xyz" -> use that value

        player_session_token=None  -> omit Player-Session-ID header
        player_session_token="abc" -> include header with that value
        """
        headers = {
            "Api-Key": api_key if api_key is not None else self.config.api_key,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            #"Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
        }
        if player_session_token is not None:
            headers["Player-Session-ID"] = player_session_token
        return headers

    def _do_request(self, url, headers, payload=None, method="GET"):
        """Execute an HTTP request and return (status_code, parsed_body)."""
        try:
            data = None
            if payload:
                data = json.dumps(payload).encode("utf-8")

            req = urllib.request.Request(
                url=url, data=data, headers=headers, method=method
            )
            response = urllib.request.urlopen(req)
            status = response.getcode()
            body = json.loads(response.read().decode("utf-8"))
            return status, body

        except urllib.error.HTTPError as err:
            status = err.code
            try:
                body = json.loads(err.read().decode("utf-8"))
            except Exception:
                body = None
            return status, body

        except Exception as e:
            error(f"Request failed: {e}")

    def _build_bet(self, amount, round_id, bet_id=None):
        """Build a minimal OperatorBet object for debit requests."""
        now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        return {
            "id": bet_id if bet_id is not None else random_bet_id(),
            "selection_id": "player_a",
            "selection_name": "Player A",
            "amount": str(amount),
            "exposure": str(amount),
            "odds": "2.00",
            "round_id": round_id,
            "game_id": self.config.game_id,
            "game_name": self.config.game_name,
            "status": "ACCEPTED",
            "inserted_at": now,
            "updated_at": now,
            "type": "BACK",
            "ip": "127.0.0.1",
            "currency_code": self.config.currency,
            "agent_id": self.config.agent_id,
        }

    def _build_settled_bet(
        self, amount, pl, round_id, outcome, bet_id=None, transaction_id=None
    ):
        """Build a SettledBet object for credit requests."""
        bet = self._build_bet(amount, round_id, bet_id)
        bet["status"] = "SETTLED"
        bet["pl"] = str(pl)
        bet["outcome"] = outcome
        if transaction_id:
            bet["transaction_id"] = transaction_id
        return bet

    # ------------------------------------------
    # Public API methods
    # ------------------------------------------

    def get_balance(
        self,
        player_session_token=None,
        api_key=None,
        player_id=None,
        should_log=True,
    ):
        """
        GET /accounts/balance/{player_id}

        Overrides:
            api_key=None           -> use config default
            player_session_token=None -> omit header
            player_id=None         -> use config default

        Returns: (http_status, response_body)
        """
        pid = player_id or self.config.player_id

        if should_log:
            token_desc = (
                "no session"
                if player_session_token is None
                else (
                    "expired session"
                    if player_session_token
                    == self.config.player_session_token_expired
                    else "valid session"
                )
            )
            log(f"Get Balance ({token_desc})")

        url = self._build_balance_url(pid)
        headers = self._build_headers(player_session_token, api_key)
        status, body = self._do_request(url, headers)

        if should_log:
            log(f"  HTTP {status} | Response: {body}")

        return status, body

    def get_balance_valid(self, should_log=True):
        """Get balance with valid player_session_token."""
        return self.get_balance(
            player_session_token=self.config.player_session_token,
            should_log=should_log,
        )

    def get_balance_without_session(self, should_log=True):
        """Get balance without Player-Session-ID header."""
        return self.get_balance(player_session_token=None, should_log=should_log)

    def get_balance_expired(self, should_log=True):
        """Get balance with expired player_session_token."""
        return self.get_balance(
            player_session_token=self.config.player_session_token_expired,
            should_log=should_log,
        )

    def debit(
        self,
        amount,
        round_id,
        transaction_id=None,
        api_key=_DEFAULT,
        player_session_token=_DEFAULT,
        player_id=None,
        assert_success=True,
        should_log=True,
    ):
        """
        POST /accounts/transactions/debit

        Overrides (for error tests):
            api_key=_DEFAULT              -> config value
            player_session_token=_DEFAULT -> config value
            player_id=None                -> config value
            assert_success=False          -> skip HTTP 200 assertion

        Returns: (http_status, response_body, transaction_id)
        """
        txn_id = transaction_id or random_uuid()
        request_id = random_uuid()
        effective_session = (
            self.config.player_session_token
            if player_session_token is _DEFAULT
            else player_session_token
        )
        effective_api_key = (
            None if api_key is _DEFAULT else api_key
        )
        effective_player_id = player_id or self.config.player_id

        if should_log:
            log(
                f"Debit: amount={amount}, round_id={round_id}, transaction_id={txn_id}"
            )

        url = self._build_debit_url()
        headers = self._build_headers(effective_session, effective_api_key)
        bet = self._build_bet(amount, round_id)

        payload = {
            "request_id": request_id,
            "transaction_id": txn_id,
            "transaction_type": "DEBIT",
            "amount": str(amount),
            "player_id": effective_player_id,
            "version": self._next_version(),
            "agent_id": self.config.agent_id,
            "round_id": round_id,
            "game_id": self.config.game_id,
            "game_name": self.config.game_name,
            "game_type": self.config.game_type,
            "new_bets": [bet],
            "accepted_bets": [],
        }

        status, body = self._do_request(url, headers, payload, method="POST")

        if should_log:
            log(f"  HTTP {status} | Response: {body}")

        if assert_success:
            test_assert(status == 200, f"Debit failed with HTTP {status}: {body}")

        return status, body, txn_id

    def credit(
        self,
        amount,
        round_id,
        sw_bet_transaction_id,
        transaction_id=None,
        api_key=_DEFAULT,
        player_session_token=_DEFAULT,
        player_id=None,
        assert_success=True,
        should_log=True,
    ):
        """
        POST /accounts/transactions/credit

        Overrides (for error tests):
            api_key=_DEFAULT              -> config value
            player_session_token=_DEFAULT -> config value
            player_id=None                -> config value
            assert_success=False          -> skip HTTP 200 assertion

        Returns: (http_status, response_body, transaction_id)
        """
        txn_id = transaction_id or random_uuid()
        request_id = random_uuid()
        effective_session = (
            self.config.player_session_token
            if player_session_token is _DEFAULT
            else player_session_token
        )
        effective_api_key = (
            None if api_key is _DEFAULT else api_key
        )
        effective_player_id = player_id or self.config.player_id

        if should_log:
            log(
                f"Credit: amount={amount}, round_id={round_id}, "
                f"sw_bet_transaction_id={sw_bet_transaction_id}"
            )

        url = self._build_credit_url()
        headers = self._build_headers(effective_session, effective_api_key)

        outcome = "WON" if to_decimal(amount) > 0 else "LOST"
        settled_bet = self._build_settled_bet(
            amount,
            amount,
            round_id,
            outcome,
            transaction_id=sw_bet_transaction_id,
        )

        payload = {
            "request_id": request_id,
            "transaction_id": txn_id,
            "sw_bet_transaction_id": sw_bet_transaction_id,
            "transaction_type": "CREDIT",
            "amount": str(amount),
            "player_id": effective_player_id,
            "agent_id": self.config.agent_id,
            "round_id": round_id,
            "game_id": self.config.game_id,
            "game_name": self.config.game_name,
            "game_type": self.config.game_type,
            "bets": [settled_bet],
        }

        status, body = self._do_request(url, headers, payload, method="POST")

        if should_log:
            log(f"  HTTP {status} | Response: {body}")

        if assert_success:
            test_assert(status == 200, f"Credit failed with HTTP {status}: {body}")

        return status, body, txn_id

    def rollback(
        self,
        amount,
        round_id,
        sw_bet_transaction_id,
        transaction_id=None,
        api_key=_DEFAULT,
        player_session_token=_DEFAULT,
        player_id=None,
        assert_success=True,
        should_log=True,
    ):
        """
        POST /accounts/transactions/rollback

        Overrides (for error tests):
            api_key=_DEFAULT              -> config value
            player_session_token=_DEFAULT -> config value
            player_id=None                -> config value
            assert_success=False          -> skip HTTP 200 assertion

        Returns: (http_status, response_body, transaction_id)
        """
        txn_id = transaction_id or random_uuid()
        request_id = random_uuid()
        effective_session = (
            self.config.player_session_token
            if player_session_token is _DEFAULT
            else player_session_token
        )
        effective_api_key = (
            None if api_key is _DEFAULT else api_key
        )
        effective_player_id = player_id or self.config.player_id

        if should_log:
            log(
                f"Rollback: amount={amount}, round_id={round_id}, "
                f"sw_bet_transaction_id={sw_bet_transaction_id}"
            )

        url = self._build_rollback_url()
        headers = self._build_headers(effective_session, effective_api_key)

        payload = {
            "request_id": request_id,
            "transaction_id": txn_id,
            "sw_bet_transaction_id": sw_bet_transaction_id,
            "transaction_type": "CREDIT",
            "amount": str(amount),
            "player_id": effective_player_id,
            "version": self._next_version(),
            "agent_id": self.config.agent_id,
            "round_id": round_id,
            "game_id": self.config.game_id,
            "game_name": self.config.game_name,
            "game_type": self.config.game_type,
        }

        status, body = self._do_request(url, headers, payload, method="POST")

        if should_log:
            log(f"  HTTP {status} | Response: {body}")

        if assert_success:
            test_assert(status == 200, f"Rollback failed with HTTP {status}: {body}")

        return status, body, txn_id

    # ------------------------------------------
    # Balance helpers
    # ------------------------------------------

    def extract_balance(self, body):
        """Extract balance from response body as Decimal."""
        test_assert(
            body is not None and "balance" in body,
            "Response missing 'balance' field",
        )
        return to_decimal(body["balance"])

    def fetch_balance(self):
        """Fetch current balance via get_balance API and return as Decimal."""
        status, body = self.get_balance_valid(should_log=False)
        test_assert(status == 200, f"Get balance failed with HTTP {status}: {body}")
        return self.extract_balance(body)

    def verify_balance(self, expected, actual, context=""):
        """Assert expected balance equals actual balance."""
        expected_dec = to_decimal(expected)
        actual_dec = to_decimal(actual)
        ctx = f" ({context})" if context else ""
        test_assert(
            expected_dec == actual_dec,
            f"Balance mismatch{ctx}: expected={expected_dec}, actual={actual_dec}",
        )
        log(f"  Balance verified: {actual_dec}{ctx}")

    def verify_balance_after_debit(self, original_balance, response_body, amount):
        """
        After a debit: new balance = original_balance - amount.
        Also fetches balance via get_balance to double-check.
        Returns the updated original_balance (= response balance).
        """
        response_balance = self.extract_balance(response_body)
        expected = to_decimal(original_balance) - to_decimal(amount)

        self.verify_balance(expected, response_balance, "debit response")

        # Double-check with get_balance
        fetched = self.fetch_balance()
        self.verify_balance(response_balance, fetched, "debit get_balance check")

        return response_balance

    def verify_balance_after_credit(self, original_balance, response_body, amount):
        """
        After a credit: new balance = original_balance + amount.
        Also fetches balance via get_balance to double-check.
        Returns the updated original_balance (= response balance).
        """
        response_balance = self.extract_balance(response_body)
        expected = to_decimal(original_balance) + to_decimal(amount)

        self.verify_balance(expected, response_balance, "credit response")

        fetched = self.fetch_balance()
        self.verify_balance(response_balance, fetched, "credit get_balance check")

        return response_balance

    def verify_balance_after_rollback(self, original_balance, response_body, amount):
        """
        After a rollback: new balance = original_balance + amount (returns debited amount).
        Also fetches balance via get_balance to double-check.
        Returns the updated original_balance (= response balance).
        """
        response_balance = self.extract_balance(response_body)
        expected = to_decimal(original_balance) + to_decimal(amount)

        self.verify_balance(expected, response_balance, "rollback response")

        fetched = self.fetch_balance()
        self.verify_balance(response_balance, fetched, "rollback get_balance check")

        return response_balance

    # ------------------------------------------
    # Error response helpers
    # ------------------------------------------

    def verify_error_response(self, status, body, expected_error_code, context=""):
        """
        Verify that the response is an error with the expected operator error code.
        expected_error_code can be a single string or a list of accepted codes.

        Checks:
        1. HTTP status is 400
        2. Response body contains a 'code' field matching one of the expected codes
        """
        ctx = f" ({context})" if context else ""
        allowed = (
            [c.upper() for c in expected_error_code]
            if isinstance(expected_error_code, (list, tuple))
            else [expected_error_code.upper()]
        )

        test_assert(
            status == 400,
            f"Expected HTTP 400 but got {status}{ctx}: {body}",
        )

        test_assert(
            body is not None and isinstance(body, dict),
            f"Expected JSON error body but got{ctx}: {body}",
        )

        actual_code = ""
        if isinstance(body.get("code"), str):
            actual_code = body["code"].upper()

        test_assert(
            actual_code in allowed,
            f"Expected error code {allowed} but got "
            f"'{actual_code}'{ctx} (HTTP {status})",
        )

        log(f"  Error verified: HTTP {status}, code={actual_code}{ctx}")
