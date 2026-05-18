"""
Exposure Wallet API Client

Provides methods to call the operator's exposure wallet endpoints:
- GET  /accounts/balance/{player_id}          (shared with seamless)
- POST /accounts/exposure                      (update exposure hold)
- POST /accounts/settlement                    (batch settlement)
- POST /accounts/rollback                      (batch rollback / resettlement)

Exposure response:  {"balance": "150.00", "version": 123}
Settlement/Rollback response:  {"results": [{"player_id": "p-123", "balance": "150.00", "version": 123}]}
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

# Sentinel: when a parameter equals _DEFAULT the config value is used.
_DEFAULT = object()


class ExposureWallet:
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

    def _build_exposure_url(self):
        return f"{self.config.wallet_base_url}/accounts/exposure"

    def _build_settlement_url(self):
        return f"{self.config.wallet_base_url}/accounts/settlement"

    def _build_rollback_url(self):
        return f"{self.config.wallet_base_url}/accounts/rollback"

    def _build_headers(self, player_session_token=None, api_key=None):
        """
        api_key=None           -> use config default
        player_session_token=None -> omit Player-Session-ID header
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
        """Build a minimal OperatorBet object."""
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

    def _build_settled_bet(self, amount, pl, round_id, outcome, bet_id=None):
        """Build a SettledBet object for settlement / rollback."""
        bet = self._build_bet(amount, round_id, bet_id)
        bet["status"] = "SETTLED"
        bet["pl"] = str(pl)
        bet["outcome"] = outcome
        return bet

    # ------------------------------------------
    # Public API methods
    # ------------------------------------------

    # ---- Balance (shared with seamless) ----

    def get_balance(
        self,
        player_session_token=None,
        api_key=None,
        player_id=None,
        should_log=True,
    ):
        """
        GET /accounts/balance/{player_id}
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
        return self.get_balance(
            player_session_token=self.config.player_session_token,
            should_log=should_log,
        )

    def get_balance_without_session(self, should_log=True):
        return self.get_balance(player_session_token=None, should_log=should_log)

    def get_balance_expired(self, should_log=True):
        return self.get_balance(
            player_session_token=self.config.player_session_token_expired,
            should_log=should_log,
        )

    # ---- Exposure ----

    def update_exposure(
        self,
        exposure,
        round_id,
        version=None,
        new_bets=None,
        accepted_bets=None,
        api_key=_DEFAULT,
        player_session_token=_DEFAULT,
        player_id=None,
        assert_success=True,
        should_log=True,
    ):
        """
        POST /accounts/exposure

        Args:
            exposure: total exposure amount to hold (positive = hold from balance)
            round_id: round identifier
            version: exposure version (auto-incremented if None)
            new_bets: list of new bets (auto-generated if None)
            accepted_bets: list of already accepted bets (empty if None)

        Returns: (http_status, response_body)
        """
        ver = version if version is not None else self._next_version()
        request_id = random_uuid()
        effective_session = (
            self.config.player_session_token
            if player_session_token is _DEFAULT
            else player_session_token
        )
        effective_api_key = None if api_key is _DEFAULT else api_key
        effective_player_id = player_id or self.config.player_id

        if should_log:
            log(
                f"Exposure: exposure={exposure}, round_id={round_id}, version={ver}"
            )

        url = self._build_exposure_url()
        headers = self._build_headers(effective_session, effective_api_key)

        # Bet amounts are always positive; the top-level exposure is negative
        bet_amount = str(abs(to_decimal(exposure)))
        if new_bets is None:
            new_bets = [self._build_bet(bet_amount, round_id)]

        payload = {
            "request_id": request_id,
            "player_id": effective_player_id,
            "exposure": str(exposure),
            "version": ver,
            "agent_id": self.config.agent_id,
            "round_id": round_id,
            "game_id": self.config.game_id,
            "new_bets": new_bets,
            "accepted_bets": accepted_bets or [],
            "exposure_by_selections": {
                "winner.player_a": str(abs(to_decimal(exposure))),
                "winner.player_b": str(exposure),
            },
        }

        status, body = self._do_request(url, headers, payload, method="POST")

        if should_log:
            log(f"  HTTP {status} | Response: {body}")

        if assert_success:
            test_assert(
                status == 200, f"Exposure failed with HTTP {status}: {body}"
            )

        return status, body

    # ---- Settlement (batch) ----

    def settle(
        self,
        round_id,
        exposure,
        pl,
        transaction_id=None,
        api_key=_DEFAULT,
        assert_success=True,
        should_log=True,
    ):
        """
        POST /accounts/settlement

        Settles a round: releases exposure and applies P/L.

        After settlement: balance = (balance_before_settlement) + exposure + pl
        Which simplifies to: balance = original_balance_before_any_exposure + pl

        Args:
            round_id: the round to settle
            exposure: the exposure amount to release (must match what was held)
            pl: profit/loss to apply (positive = player won, negative = lost)
            transaction_id: for idempotency (auto-generated if None)

        Returns: (http_status, response_body, transaction_id)
        """
        txn_id = transaction_id or random_uuid()
        request_id = random_uuid()
        effective_api_key = None if api_key is _DEFAULT else api_key

        if should_log:
            log(
                f"Settlement: round_id={round_id}, exposure={exposure}, "
                f"pl={pl}, transaction_id={txn_id}"
            )

        url = self._build_settlement_url()
        # Settlement does NOT include Player-Session-ID at the top level;
        # each settlement item carries player_session_token in the body.
        headers = self._build_headers(None, effective_api_key)

        amount = str(to_decimal(exposure))
        outcome = "WON" if to_decimal(pl) >= 0 else "LOST"
        settled_bet = self._build_settled_bet(amount, pl, round_id, outcome)

        settlement_item = {
            "request_id": request_id,
            "transaction_id": txn_id,
            "player_id": self.config.player_id,
            "exposure": str(exposure),
            "pl": str(pl),
            "bets": [settled_bet],
            "agent_id": self.config.agent_id,
            "round_id": round_id,
            "game_id": self.config.game_id,
            "player_session_token": self.config.player_session_token,
            "exposure_by_selections": {
                "winner.player_a": str(exposure),
                "winner.player_b": str(to_decimal(exposure) * -1),
            },
        }

        payload = {
            "round_id": round_id,
            "game_id": self.config.game_id,
            "settlements": [settlement_item],
        }

        status, body = self._do_request(url, headers, payload, method="POST")

        if should_log:
            log(f"  HTTP {status} | Response: {body}")

        if assert_success:
            test_assert(
                status == 200, f"Settlement failed with HTTP {status}: {body}"
            )

        return status, body, txn_id

    # ---- Rollback / Resettlement (batch) ----

    def rollback(
        self,
        round_id,
        rollback_pl,
        pl,
        rollback_transaction_id=None,
        transaction_id=None,
        api_key=_DEFAULT,
        assert_success=True,
        should_log=True,
    ):
        """
        POST /accounts/rollback

        Rolls back a previous settlement and applies a new resettlement P/L.

        balance_after = balance_before + rollback_pl + pl

        Args:
            round_id: the round to rollback/resettle
            rollback_pl: amount to reverse from previous settlement
                         (e.g. previous pl was +8, rollback_pl = -8)
            pl: new resettled P/L to apply
            rollback_transaction_id: idempotency key for the rollback part
            transaction_id: idempotency key for the resettlement part

        Returns: (http_status, response_body, transaction_id, rollback_transaction_id)
        """
        txn_id = transaction_id or random_uuid()
        rb_txn_id = rollback_transaction_id or random_uuid()
        request_id = random_uuid()
        effective_api_key = None if api_key is _DEFAULT else api_key

        if should_log:
            log(
                f"Rollback: round_id={round_id}, rollback_pl={rollback_pl}, "
                f"pl={pl}, txn_id={txn_id}, rb_txn_id={rb_txn_id}"
            )

        url = self._build_rollback_url()
        # Rollback does NOT include Player-Session-ID
        headers = self._build_headers(None, effective_api_key)

        outcome = "WON" if to_decimal(pl) >= 0 else "LOST"
        settled_bet = self._build_settled_bet("10", pl, round_id, outcome)

        rollback_item = {
            "request_id": request_id,
            "rollback_transaction_id": rb_txn_id,
            "transaction_id": txn_id,
            "player_id": self.config.player_id,
            "rollback_pl": str(rollback_pl),
            "pl": str(pl),
            "bets": [settled_bet],
            "agent_id": self.config.agent_id,
            "round_id": round_id,
            "game_id": self.config.game_id,
        }

        payload = {
            "round_id": round_id,
            "game_id": self.config.game_id,
            "rollbacks": [rollback_item],
        }

        status, body = self._do_request(url, headers, payload, method="POST")

        if should_log:
            log(f"  HTTP {status} | Response: {body}")

        if assert_success:
            test_assert(
                status == 200, f"Rollback failed with HTTP {status}: {body}"
            )

        return status, body, txn_id, rb_txn_id

    # ------------------------------------------
    # Balance helpers
    # ------------------------------------------

    def extract_balance(self, body):
        """Extract balance from a single-entity response {balance, version}."""
        test_assert(
            body is not None and "balance" in body,
            "Response missing 'balance' field",
        )
        return to_decimal(body["balance"])

    def extract_balance_from_batch(self, body):
        """
        Extract balance from a batch response {results: [{player_id, balance, version}]}.
        Returns the balance for the configured player_id.
        """
        test_assert(
            body is not None and "results" in body,
            f"Response missing 'results' field: {body}",
        )
        results = body["results"]
        test_assert(
            isinstance(results, list) and len(results) > 0,
            f"Expected non-empty results list: {body}",
        )
        for r in results:
            if r.get("player_id") == self.config.player_id:
                return to_decimal(r["balance"])
        # If only one result, use it regardless of player_id
        if len(results) == 1:
            return to_decimal(results[0]["balance"])
        test_assert(
            False,
            f"Player {self.config.player_id} not found in results: {results}",
        )

    def try_extract_balance_from_batch(self, body):
        """
        Try to extract balance from a batch response.
        Returns the balance as Decimal if found, or None if not present.
        Does NOT raise on missing data -- used for idempotency checks where
        the response may omit balance.
        """
        if body is None or not isinstance(body, dict):
            return None
        results = body.get("results")
        if not isinstance(results, list) or len(results) == 0:
            return None
        for r in results:
            if r.get("player_id") == self.config.player_id and "balance" in r:
                return to_decimal(r["balance"])
        if len(results) == 1 and "balance" in results[0]:
            return to_decimal(results[0]["balance"])
        return None

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

    def verify_balance_after_exposure(
        self, original_balance, response_body, exposure
    ):
        """
        After exposure: balance = original_balance + exposure.
        (exposure is negative, so balance decreases)
        Returns the response balance.
        """
        response_balance = self.extract_balance(response_body)
        expected = to_decimal(original_balance) + to_decimal(exposure)
        self.verify_balance(expected, response_balance, "exposure response")
        fetched = self.fetch_balance()
        self.verify_balance(response_balance, fetched, "exposure get_balance check")
        return response_balance

    def verify_balance_after_settlement(
        self, balance_before_settlement, response_body, exposure, pl
    ):
        """
        After settlement: balance = balance_before + abs(exposure) + pl.
        (exposure is negative; abs(exposure) releases the hold, then apply P/L)
        Returns the response balance.
        """
        response_balance = self.extract_balance_from_batch(response_body)
        expected = (
            to_decimal(balance_before_settlement)
            + abs(to_decimal(exposure))
            + to_decimal(pl)
        )
        self.verify_balance(expected, response_balance, "settlement response")
        fetched = self.fetch_balance()
        self.verify_balance(response_balance, fetched, "settlement get_balance check")
        return response_balance

    def verify_balance_after_rollback(
        self, balance_before_rollback, response_body, rollback_pl, pl
    ):
        """
        After rollback/resettlement:
            balance = balance_before_rollback + rollback_pl + pl
        Returns the response balance.
        """
        response_balance = self.extract_balance_from_batch(response_body)
        expected = (
            to_decimal(balance_before_rollback)
            + to_decimal(rollback_pl)
            + to_decimal(pl)
        )
        self.verify_balance(expected, response_balance, "rollback response")
        fetched = self.fetch_balance()
        self.verify_balance(response_balance, fetched, "rollback get_balance check")
        return response_balance

    # ------------------------------------------
    # Error response helpers
    # ------------------------------------------

    def verify_error_response(self, status, body, expected_error_code, context=""):
        """
        Verify error response: HTTP 400 and matching error code.
        expected_error_code can be a single string or a list of accepted codes.
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
