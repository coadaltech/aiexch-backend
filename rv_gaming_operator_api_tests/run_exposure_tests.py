#!/usr/bin/env python3
"""
Operator API Test Suite - Exposure Wallet Verification

Tests the operator's exposure wallet implementation by calling the wallet
endpoints and verifying balance changes after each operation.

Exposure model:
  - Exposure holds funds from the player's balance during a round.
  - Settlement releases exposure and applies P/L.
  - Rollback reverses a settlement and applies a new P/L.

Usage:
    python3 run_exposure_tests.py [test_name]

Available tests:
    get_balance                  - Get balance with valid/no/expired session
    basic_exposure_settlement    - Exposure + settlement, verify balance
    exposure_updates             - Multiple exposure updates in a round
    exposure_settle_rollback     - Exposure + settle + rollback/resettle
    idempotency                  - Same version/txn_id must not apply twice
    errors                       - Invalid key / expired / insufficient / blocked
    all                          - Run all tests
"""

import os
import sys
import datetime

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from exposure_wallet import ExposureWallet
from utils import (
    log,
    random_round_id,
    random_uuid,
    to_decimal,
    test_assert,
    TestFailure,
)


# ==============================================================
# Test 1: Get Balance
# ==============================================================


def test_get_balance(wallet):
    """
    Same as seamless -- balance endpoint is shared.
    1. Valid session    -> 200
    2. No session       -> 200
    3. Expired session  -> 200
    """
    log("-- Test: Get Balance with valid session --")
    status, body = wallet.get_balance_valid()
    if status != 200:
        raise TestFailure(
            f"Get balance with valid session failed: HTTP {status}, body={body}"
        )
    wallet.extract_balance(body)
    log("  PASSED: balance returned with valid session")

    print()
    log("-- Test: Get Balance without session --")
    status, body = wallet.get_balance_without_session()
    if status != 200:
        raise TestFailure(
            f"Get balance without session failed: HTTP {status}, body={body}"
        )
    wallet.extract_balance(body)
    log("  PASSED: balance returned without session")

    print()
    log("-- Test: Get Balance with expired session --")
    status, body = wallet.get_balance_expired()
    if status != 200:
        raise TestFailure(
            f"Get balance with expired session failed: HTTP {status}, body={body}"
        )
    wallet.extract_balance(body)
    log("  PASSED: balance returned with expired session")


# ==============================================================
# Test 2: Basic Exposure + Settlement
# ==============================================================


def test_basic_exposure_settlement(wallet):
    """
    1. Get balance -> original_balance
    2. Exposure (-amount) -> balance = original + (-amount) = original - amount
    3. Settlement (release abs(exposure), apply pl = +5)
       -> balance = (original - amount) + amount + 5 = original + 5
    """
    amount = to_decimal(wallet.config.amount)
    exposure = str(amount * -1)  # negative
    pl = "5.00"
    round_id = random_round_id()

    log("-- Step 1: Get original balance --")
    original_balance = wallet.fetch_balance()
    log(f"  Original balance: {original_balance}")

    # Exposure (negative)
    print()
    log(f"-- Step 2: Update exposure ({exposure}) --")
    _status, body = wallet.update_exposure(exposure, round_id)
    current_balance = wallet.verify_balance_after_exposure(
        original_balance, body, exposure
    )

    # Settlement (player wins 5)
    print()
    log(f"-- Step 3: Settlement (exposure={exposure}, pl=+{pl}) --")
    _status, body, _txn = wallet.settle(round_id, exposure, pl)
    current_balance = wallet.verify_balance_after_settlement(
        current_balance, body, exposure, pl
    )

    # Final check: balance should be original + pl
    expected_final = to_decimal(original_balance) + to_decimal(pl)
    wallet.verify_balance(expected_final, current_balance, "final = original + pl")


# ==============================================================
# Test 3: Exposure Updates (multiple bets in same round)
# ==============================================================


def test_exposure_updates(wallet):
    """
    Multiple exposure updates in the same round (increasing bets).
    Exposure is a TOTAL (negative), not incremental -- each update replaces the previous.

    1. Get balance -> original
    2. Exposure v1 (-amount)     -> balance = original - amount
    3. Exposure v2 (-amount*2)   -> balance = original - amount*2
    4. Exposure v3 (-amount*3)   -> balance = original - amount*3
    5. Settlement (exposure=-amount*3, pl=-amount) -> player lost 1 bet
       -> balance = original - amount
    """
    amount = to_decimal(wallet.config.amount)
    round_id = random_round_id()

    log("-- Step 1: Get original balance --")
    original_balance = wallet.fetch_balance()
    log(f"  Original balance: {original_balance}")

    # Exposure v1 (negative)
    print()
    exp1 = str(amount * -1)
    log(f"-- Step 2: Exposure v1 ({exp1}, 1 bet) --")
    _status, body = wallet.update_exposure(exp1, round_id, version=1)
    current_balance = wallet.verify_balance_after_exposure(
        original_balance, body, exp1
    )

    # Exposure v2 (replaces v1, larger negative)
    print()
    exp2 = str(amount * -2)
    log(f"-- Step 3: Exposure v2 ({exp2}, 2 bets) --")
    _status, body = wallet.update_exposure(exp2, round_id, version=2)
    current_balance = wallet.verify_balance_after_exposure(
        original_balance, body, exp2
    )

    # Exposure v3 (replaces v2, larger negative)
    print()
    exp3 = str(amount * -3)
    log(f"-- Step 4: Exposure v3 ({exp3}, 3 bets) --")
    _status, body = wallet.update_exposure(exp3, round_id, version=3)
    current_balance = wallet.verify_balance_after_exposure(
        original_balance, body, exp3
    )

    # Settlement: player lost 1 bet amount
    print()
    pl = str(amount * -1)
    log(f"-- Step 5: Settlement (exposure={exp3}, pl={pl}) --")
    _status, body, _txn = wallet.settle(round_id, exp3, pl)
    current_balance = wallet.verify_balance_after_settlement(
        current_balance, body, exp3, pl
    )

    expected_final = original_balance + to_decimal(pl)
    wallet.verify_balance(
        expected_final, current_balance, "final = original + pl"
    )


# ==============================================================
# Test 4: Exposure + Settlement + Rollback/Resettlement
# ==============================================================


def test_exposure_settle_rollback(wallet):
    """
    1. Get balance -> original
    2. Exposure (-amount) -> balance = original - amount
    3. Settlement (exposure=-amount, pl=-5) -> balance = original - 5
    4. Rollback/Resettle (rollback_pl=+5, new pl=-3)
       -> balance = (original - 5) + 5 + (-3) = original - 3
    """
    amount = to_decimal(wallet.config.amount)
    exposure = str(amount * -1)
    round_id = random_round_id()
    settlement_pl = "-5.00"

    log("-- Step 1: Get original balance --")
    original_balance = wallet.fetch_balance()
    log(f"  Original balance: {original_balance}")

    # Exposure (negative)
    print()
    log(f"-- Step 2: Update exposure ({exposure}) --")
    _status, body = wallet.update_exposure(exposure, round_id)
    current_balance = wallet.verify_balance_after_exposure(
        original_balance, body, exposure
    )

    # Settlement (player lost 5)
    print()
    log(f"-- Step 3: Settlement (exposure={exposure}, pl={settlement_pl}) --")
    _status, body, _txn = wallet.settle(round_id, exposure, settlement_pl)
    current_balance = wallet.verify_balance_after_settlement(
        current_balance, body, exposure, settlement_pl
    )

    # Rollback/Resettle: reverse the -5 pl, apply new -3 pl
    print()
    rollback_pl = "5.00"  # reverse the -5
    new_pl = "-3.00"  # new resettled outcome
    log(f"-- Step 4: Rollback (rollback_pl={rollback_pl}, new pl={new_pl}) --")
    _status, body, _txn, _rb_txn = wallet.rollback(
        round_id, rollback_pl, new_pl
    )
    current_balance = wallet.verify_balance_after_rollback(
        current_balance, body, rollback_pl, new_pl
    )

    expected_final = original_balance + to_decimal(new_pl)
    wallet.verify_balance(
        expected_final, current_balance, "final = original + new_pl"
    )


# ==============================================================
# Test 5: Idempotency
# ==============================================================


def test_idempotency(wallet):
    """
    1. Exposure same version -> balance must not change
    2. Settlement same transaction_id -> balance must not change
    3. Rollback same IDs -> balance must not change
    """
    amount = to_decimal(wallet.config.amount)
    exposure = str(amount * -1)  # negative

    # -- Exposure idempotency (same version) --
    log("-- Exposure Idempotency (same version) --")
    round_id = random_round_id()
    original_balance = wallet.fetch_balance()
    log(f"  Original balance: {original_balance}")

    _status, body = wallet.update_exposure(exposure, round_id, version=1)
    balance_first = wallet.extract_balance(body)
    expected = to_decimal(original_balance) + to_decimal(exposure)
    wallet.verify_balance(expected, balance_first, "first exposure v1")

    log("  Re-sending exposure with same version ...")
    _status, body = wallet.update_exposure(exposure, round_id, version=1)
    balance_second = wallet.extract_balance(body)
    wallet.verify_balance(
        balance_first, balance_second, "idempotent exposure - balance must be same"
    )
    fetched = wallet.fetch_balance()
    wallet.verify_balance(balance_first, fetched, "get_balance after idempotent exposure")
    log("  PASSED: exposure idempotency")

    # Settle this round so it's clean
    wallet.settle(round_id, exposure, "0.00", should_log=False)

    # -- Settlement idempotency (same transaction_id) --
    print()
    log("-- Settlement Idempotency (same transaction_id) --")
    round_id = random_round_id()
    wallet.update_exposure(exposure, round_id, should_log=False)
    balance_before_settle = wallet.fetch_balance()
    log(f"  Balance before settlement: {balance_before_settle}")

    settle_txn = random_uuid()
    pl = "5.00"
    _status, body, _ = wallet.settle(
        round_id, exposure, pl, transaction_id=settle_txn
    )
    balance_first = wallet.extract_balance_from_batch(body)
    expected = to_decimal(balance_before_settle) + abs(to_decimal(exposure)) + to_decimal(pl)
    wallet.verify_balance(expected, balance_first, "first settlement")

    log("  Re-sending settlement with same transaction_id ...")
    _status, body, _ = wallet.settle(
        round_id, exposure, pl, transaction_id=settle_txn
    )
    # Balance may or may not be present in idempotent response
    balance_second = wallet.try_extract_balance_from_batch(body)
    if balance_second is not None:
        wallet.verify_balance(
            balance_first,
            balance_second,
            "idempotent settlement - balance must be same",
        )
    else:
        log("  Response has no balance -- skipping response balance check")
    fetched = wallet.fetch_balance()
    wallet.verify_balance(
        balance_first, fetched, "get_balance after idempotent settlement"
    )
    log("  PASSED: settlement idempotency")

    # -- Rollback idempotency --
    print()
    log("-- Rollback Idempotency (same transaction IDs) --")
    # Use the round we just settled for rollback
    balance_before_rb = wallet.fetch_balance()
    log(f"  Balance before rollback: {balance_before_rb}")

    rb_txn = random_uuid()
    re_txn = random_uuid()
    rollback_pl = "-5.00"
    new_pl = "3.00"

    _status, body, _, _ = wallet.rollback(
        round_id, rollback_pl, new_pl,
        rollback_transaction_id=rb_txn, transaction_id=re_txn,
    )
    balance_first = wallet.extract_balance_from_batch(body)
    expected = (
        to_decimal(balance_before_rb)
        + to_decimal(rollback_pl)
        + to_decimal(new_pl)
    )
    wallet.verify_balance(expected, balance_first, "first rollback")

    log("  Re-sending rollback with same transaction IDs ...")
    _status, body, _, _ = wallet.rollback(
        round_id, rollback_pl, new_pl,
        rollback_transaction_id=rb_txn, transaction_id=re_txn,
    )
    # Balance may or may not be present in idempotent response
    balance_second = wallet.try_extract_balance_from_batch(body)
    if balance_second is not None:
        wallet.verify_balance(
            balance_first,
            balance_second,
            "idempotent rollback - balance must be same",
        )
    else:
        log("  Response has no balance -- skipping response balance check")
    fetched = wallet.fetch_balance()
    wallet.verify_balance(
        balance_first, fetched, "get_balance after idempotent rollback"
    )
    log("  PASSED: rollback idempotency")


# ==============================================================
# Test 6: Error Scenarios
# ==============================================================


def test_errors(wallet):
    """
    All sub-tests run even if earlier ones fail.
    """
    amount = to_decimal(wallet.config.amount)
    exposure = str(amount * -1)  # negative
    insufficient_exposure = str(to_decimal(wallet.config.amount_insufficient_funds) * -1)
    round_id = random_round_id()
    failures = []

    def _run(name, fn):
        try:
            fn()
            log(f"  PASSED: {name}")
        except TestFailure as e:
            log(f"  FAILED: {name} -- {e}")
            failures.append(f"{name}: {e}")
        except Exception as e:
            log(f"  ERROR:  {name} -- {e}")
            failures.append(f"{name}: {e}")

    # 1. Get Balance - invalid API key
    def _err_balance_invalid_key():
        log("-- Error: Get Balance with invalid API key --")
        status, body = wallet.get_balance(
            player_session_token=wallet.config.player_session_token,
            api_key=wallet.config.api_key_invalid,
        )
        wallet.verify_error_response(status, body, "INVALID_API_KEY", "get_balance")

    _run("Get Balance - invalid API key", _err_balance_invalid_key)

    # 2. Exposure - invalid API key
    def _err_exposure_invalid_key():
        log("-- Error: Exposure with invalid API key --")
        status, body = wallet.update_exposure(
            exposure, round_id,
            api_key=wallet.config.api_key_invalid,
            assert_success=False,
        )
        wallet.verify_error_response(status, body, "INVALID_API_KEY", "exposure")

    print()
    _run("Exposure - invalid API key", _err_exposure_invalid_key)

    # 3. Exposure - expired session
    def _err_exposure_expired():
        log("-- Error: Exposure with expired session --")
        balance_before = wallet.fetch_balance()
        log(f"  Balance before: {balance_before}")
        status, body = wallet.update_exposure(
            exposure, round_id,
            player_session_token=wallet.config.player_session_token_expired,
            assert_success=False,
        )
        wallet.verify_error_response(status, body, ["TOKEN_EXPIRED", "INVALID_SESSION_TOKEN"], "exposure expired")
        balance_after = wallet.fetch_balance()
        wallet.verify_balance(balance_before, balance_after, "balance unchanged after expired exposure")

    print()
    _run("Exposure - expired session", _err_exposure_expired)

    # 4. Exposure - invalid session token
    def _err_exposure_invalid_session():
        log("-- Error: Exposure with invalid player_session_token --")
        balance_before = wallet.fetch_balance()
        log(f"  Balance before: {balance_before}")
        status, body = wallet.update_exposure(
            exposure, round_id,
            player_session_token="invalid-random-token",
            assert_success=False,
        )
        wallet.verify_error_response(status, body, ["TOKEN_EXPIRED", "INVALID_SESSION_TOKEN"], "exposure invalid session")
        balance_after = wallet.fetch_balance()
        wallet.verify_balance(balance_before, balance_after, "balance unchanged after invalid session exposure")

    print()
    _run("Exposure - invalid session token", _err_exposure_invalid_session)

    # 5. Exposure - insufficient funds
    def _err_exposure_insufficient():
        log("-- Error: Exposure with insufficient funds --")
        balance_before = wallet.fetch_balance()
        log(f"  Balance before: {balance_before}")
        status, body = wallet.update_exposure(
            insufficient_exposure, round_id,
            player_session_token=wallet.config.player_session_token,
            assert_success=False,
        )
        wallet.verify_error_response(
            status, body, "INSUFFICIENT_FUNDS", "exposure insufficient"
        )
        balance_after = wallet.fetch_balance()
        wallet.verify_balance(balance_before, balance_after, "balance unchanged after insufficient exposure")

    print()
    _run("Exposure - insufficient funds", _err_exposure_insufficient)

    # 6. Settlement - invalid API key
    def _err_settlement_invalid_key():
        log("-- Error: Settlement with invalid API key --")
        r = random_round_id()
        wallet.update_exposure(exposure, r, should_log=False)
        status, body, _ = wallet.settle(
            r, exposure, "0.00",
            api_key=wallet.config.api_key_invalid,
            assert_success=False,
        )
        wallet.verify_error_response(status, body, "INVALID_API_KEY", "settlement")

    print()
    _run("Settlement - invalid API key", _err_settlement_invalid_key)

    # 7. Rollback - invalid API key
    def _err_rollback_invalid_key():
        log("-- Error: Rollback with invalid API key --")
        r = random_round_id()
        wallet.update_exposure(exposure, r, should_log=False)
        wallet.settle(r, exposure, "0.00", should_log=False)
        status, body, _, _ = wallet.rollback(
            r, "0.00", "0.00",
            api_key=wallet.config.api_key_invalid,
            assert_success=False,
        )
        wallet.verify_error_response(status, body, "INVALID_API_KEY", "rollback")

    print()
    _run("Rollback - invalid API key", _err_rollback_invalid_key)

    # 8. Exposure - account blocked (optional)
    if wallet.config.blocked_player_id:
        def _err_exposure_blocked():
            log("-- Error: Exposure with blocked player --")
            status, body = wallet.update_exposure(
                exposure, round_id,
                player_id=wallet.config.blocked_player_id,
                player_session_token=wallet.config.blocked_player_session_token or None,
                assert_success=False,
            )
            wallet.verify_error_response(
                status, body, "ACCOUNT_BLOCKED", "exposure blocked"
            )

        print()
        _run("Exposure - account blocked", _err_exposure_blocked)
    else:
        print()
        log("  Skipping ACCOUNT_BLOCKED test (blocked_player_id not configured)")

    if failures:
        summary = "\n    ".join(failures)
        raise TestFailure(
            f"{len(failures)} error sub-test(s) failed:\n    {summary}"
        )


# ==============================================================
# Test runner
# ==============================================================

TESTS = {
    "get_balance": ("Get Balance (valid / no session / expired)", test_get_balance),
    "basic_exposure_settlement": (
        "Basic Exposure + Settlement",
        test_basic_exposure_settlement,
    ),
    "exposure_updates": (
        "Exposure Updates (multiple bets in round)",
        test_exposure_updates,
    ),
    "exposure_settle_rollback": (
        "Exposure + Settlement + Rollback/Resettlement",
        test_exposure_settle_rollback,
    ),
    "idempotency": (
        "Idempotency (exposure / settlement / rollback)",
        test_idempotency,
    ),
    "errors": (
        "Error Scenarios (invalid key / expired / insufficient / blocked)",
        test_errors,
    ),
}


def run_test(name, description, func, wallet):
    print()
    print("=" * 60)
    print(f"  TEST: {description}")
    print("=" * 60)
    print()

    try:
        func(wallet)
        print()
        log(f"PASSED: {description}")
        return True
    except TestFailure as e:
        print()
        log(f"FAILED: {description}")
        log(f"  Reason: {e}")
        return False
    except Exception as e:
        print()
        log(f"ERROR: {description}")
        log(f"  Exception: {e}")
        return False


def run_all(wallet):
    results = {}
    for name, (description, func) in TESTS.items():
        passed = run_test(name, description, func, wallet)
        results[name] = passed

    print()
    print()
    print("=" * 60)
    print("  TEST SUMMARY")
    print("=" * 60)

    total = len(results)
    passed = sum(1 for v in results.values() if v)
    failed = total - passed

    for name, success in results.items():
        description = TESTS[name][0]
        status = "PASSED" if success else "FAILED"
        marker = "+" if success else "x"
        print(f"  [{marker}] {status}: {description}")

    print()
    print(f"  Total: {total} | Passed: {passed} | Failed: {failed}")
    print("=" * 60)

    return failed == 0


def print_usage():
    test_names = "\n".join(
        f"    {name:30s} - {desc}" for name, (desc, _) in TESTS.items()
    )
    print(
        f"""
Operator API Test Suite - Exposure Wallet Verification

Usage: python3 run_exposure_tests.py <test_name>

Available tests:
{test_names}
    {"all":30s} - Run all tests

Configuration:
    Edit config.cfg with your operator wallet details before running.
"""
    )


# ==============================================================
# Main
# ==============================================================

if __name__ == "__main__":
    start = datetime.datetime.now()

    config_path = os.path.join(_SCRIPT_DIR, "config.cfg")
    wallet = ExposureWallet(config_path)

    print("Operator API Test Suite - Exposure Wallet Verification")
    print()
    print(f"  Wallet URL:  {wallet.config.wallet_base_url}")
    print(f"  Player ID:   {wallet.config.player_id}")
    print(f"  API Key:     {wallet.config.api_key}")
    print(f"  Amount:      {wallet.config.amount}")
    print()

    if len(sys.argv) < 2:
        print_usage()
        sys.exit(0)

    method = sys.argv[1]

    if method == "all":
        success = run_all(wallet)
    elif method in TESTS:
        description, func = TESTS[method]
        success = run_test(method, description, func, wallet)
    else:
        print(f"Unknown test: {method}")
        print_usage()
        sys.exit(1)

    elapsed = datetime.datetime.now() - start
    elapsed_secs = elapsed.seconds + (elapsed.days * 24 * 3600)

    print()
    if success:
        log(f"Test successful! Completed in {elapsed_secs} seconds")
    else:
        log(f"Test NOT successful! Completed in {elapsed_secs} seconds")
        sys.exit(1)
