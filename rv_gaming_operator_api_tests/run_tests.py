#!/usr/bin/env python3
"""
Operator API Test Suite - Seamless Wallet Verification

Tests the operator's seamless wallet implementation by calling the wallet
endpoints and verifying balance changes after each transaction.

Usage:
    python run_tests.py [test_name]

Available tests:
    get_balance                 - Get balance with valid/no/expired session
    transactions                - Basic debit + debit + credit + rollback flow
    three_debit_one_credit      - 3 debits then 1 credit
    three_debit_three_credit    - 3 debits then 3 credits
    one_debit_three_credit      - 1 debit then 3 credits
    mixed_transactions          - 2 debits, 1 rollback, 2 credits
    all                         - Run all tests
"""

import os
import sys
import datetime

# Ensure imports work when invoked from any directory
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from seamless_wallet import SeamlessWallet
from utils import log, random_round_id, random_uuid, to_decimal, test_assert, TestFailure


# ==============================================================
# Test 1: Get Balance
# ==============================================================


def test_get_balance(wallet):
    """
    Test get_balance endpoint:
    1. Get balance with valid player_session_token    -> expect 200
    2. Get balance without player_session_token       -> expect 200
    3. Get balance with expired player_session_token  -> expect 200

    Per API spec: "It must be possible to retrieve balance if token is
    expired or missing as round can settle outside life of player session."
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
# Test 2: Basic Transactions (2 debits + 1 credit + 1 rollback)
# ==============================================================


def test_transactions(wallet):
    """
    Basic transaction flow:
    1. Get balance -> original_balance
    2. Debit 1 -> verify: original_balance - amount == response balance
    3. Debit 2 -> verify: updated balance  - amount == response balance
    4. Credit (for debit 1) -> verify: updated balance + amount == response balance
    5. Rollback (for debit 2) -> verify: updated balance + amount == response balance
    """
    amount = wallet.config.amount
    round_id = random_round_id()

    # Step 1: Get original balance
    log("-- Step 1: Get original balance --")
    original_balance = wallet.fetch_balance()
    log(f"  Original balance: {original_balance}")

    # Step 2: First debit
    print()
    log("-- Step 2: First debit --")
    _status, body, debit_txn_1 = wallet.debit(amount, round_id)
    original_balance = wallet.verify_balance_after_debit(
        original_balance, body, amount
    )

    # Step 3: Second debit
    print()
    log("-- Step 3: Second debit --")
    _status, body, debit_txn_2 = wallet.debit(amount, round_id)
    original_balance = wallet.verify_balance_after_debit(
        original_balance, body, amount
    )

    # Step 4: Credit for debit 1
    print()
    log("-- Step 4: Credit (for debit 1) --")
    _status, body, _credit_txn = wallet.credit(
        amount, round_id, sw_bet_transaction_id=debit_txn_1
    )
    original_balance = wallet.verify_balance_after_credit(
        original_balance, body, amount
    )

    # Step 5: Rollback for debit 2
    print()
    log("-- Step 5: Rollback (for debit 2) --")
    _status, body, _rollback_txn = wallet.rollback(
        amount, round_id, sw_bet_transaction_id=debit_txn_2
    )
    original_balance = wallet.verify_balance_after_rollback(
        original_balance, body, amount
    )


# ==============================================================
# Test 3: Three Debits + One Credit
# ==============================================================


def test_three_debit_one_credit(wallet):
    """
    3 debits then 1 credit, verify balance after each:
    - Debit 1: balance decreases by amount
    - Debit 2: balance decreases by amount
    - Debit 3: balance decreases by amount
    - Credit (for debit 3): balance increases by amount
    """
    amount = wallet.config.amount
    round_id = random_round_id()

    log("-- Get original balance --")
    original_balance = wallet.fetch_balance()
    log(f"  Original balance: {original_balance}")

    # Debit 1
    print()
    log("-- Debit 1 of 3 --")
    _status, body, debit_txn_1 = wallet.debit(amount, round_id)
    original_balance = wallet.verify_balance_after_debit(
        original_balance, body, amount
    )

    # Debit 2
    print()
    log("-- Debit 2 of 3 --")
    _status, body, debit_txn_2 = wallet.debit(amount, round_id)
    original_balance = wallet.verify_balance_after_debit(
        original_balance, body, amount
    )

    # Debit 3
    print()
    log("-- Debit 3 of 3 --")
    _status, body, debit_txn_3 = wallet.debit(amount, round_id)
    original_balance = wallet.verify_balance_after_debit(
        original_balance, body, amount
    )

    # Credit for debit 3
    print()
    log("-- Credit (for debit 3) --")
    _status, body, _credit_txn = wallet.credit(
        amount, round_id, sw_bet_transaction_id=debit_txn_3
    )
    original_balance = wallet.verify_balance_after_credit(
        original_balance, body, amount
    )


# ==============================================================
# Test 4: Three Debits + Three Credits
# ==============================================================


def test_three_debit_three_credit(wallet):
    """
    3 debits then 3 credits, verify balance after each:
    - Debit 1-3: balance decreases by amount each
    - Credit 1 (for debit 1): balance increases by amount
    - Credit 2 (for debit 2): balance increases by amount
    - Credit 3 (for debit 3): balance increases by amount
    """
    amount = wallet.config.amount
    round_id = random_round_id()

    log("-- Get original balance --")
    original_balance = wallet.fetch_balance()
    log(f"  Original balance: {original_balance}")

    # 3 Debits
    debit_txns = []
    for i in range(1, 4):
        print()
        log(f"-- Debit {i} of 3 --")
        _status, body, debit_txn = wallet.debit(amount, round_id)
        original_balance = wallet.verify_balance_after_debit(
            original_balance, body, amount
        )
        debit_txns.append(debit_txn)

    # 3 Credits (each referencing corresponding debit)
    for i in range(1, 4):
        print()
        log(f"-- Credit {i} of 3 (for debit {i}) --")
        _status, body, _credit_txn = wallet.credit(
            amount, round_id, sw_bet_transaction_id=debit_txns[i - 1]
        )
        original_balance = wallet.verify_balance_after_credit(
            original_balance, body, amount
        )


# ==============================================================
# Test 5: One Debit + Three Credits
# ==============================================================


def test_one_debit_three_credit(wallet):
    """
    1 debit then 3 credits referencing the same debit:
    - Debit 1: balance decreases by amount
    - Credit 1 (for debit 1): balance increases by amount
    - Credit 2 (for debit 1): duplicate sw_bet_transaction_id, balance must NOT change
    - Credit 3 (for debit 1): duplicate sw_bet_transaction_id, balance must NOT change
    """
    amount = wallet.config.amount
    round_id = random_round_id()

    log("-- Get original balance --")
    original_balance = wallet.fetch_balance()
    log(f"  Original balance: {original_balance}")

    # 1 Debit
    print()
    log("-- Debit 1 --")
    _status, body, debit_txn_1 = wallet.debit(amount, round_id)
    original_balance = wallet.verify_balance_after_debit(
        original_balance, body, amount
    )

    # Credit 1 - first credit, balance should increase
    print()
    log("-- Credit 1 of 3 (for debit 1) --")
    _status, body, credit_txn_1 = wallet.credit(
        amount, round_id, sw_bet_transaction_id=debit_txn_1
    )
    original_balance = wallet.verify_balance_after_credit(
        original_balance, body, amount
    )

    # Credit 2 - duplicate (same transaction_id), balance must NOT change
    print()
    log("-- Credit 2 of 3 (for debit 1) - duplicate, balance must not change --")
    _status, body, _ = wallet.credit(
        amount, round_id, sw_bet_transaction_id=debit_txn_1,
        transaction_id=credit_txn_1,
        assert_success=False,
    )
    response_balance = wallet.extract_balance(body)
    wallet.verify_balance(original_balance, response_balance, "duplicate credit 2 response - balance unchanged")
    fetched = wallet.fetch_balance()
    wallet.verify_balance(original_balance, fetched, "duplicate credit 2 get_balance check")

    # Credit 3 - duplicate (same transaction_id), balance must NOT change
    print()
    log("-- Credit 3 of 3 (for debit 1) - duplicate, balance must not change --")
    _status, body, _ = wallet.credit(
        amount, round_id, sw_bet_transaction_id=debit_txn_1,
        transaction_id=credit_txn_1,
        assert_success=False,
    )
    response_balance = wallet.extract_balance(body)
    wallet.verify_balance(original_balance, response_balance, "duplicate credit 3 response - balance unchanged")
    fetched = wallet.fetch_balance()
    wallet.verify_balance(original_balance, fetched, "duplicate credit 3 get_balance check")


# ==============================================================
# Test 6: Mixed Transactions (2 debits + 1 rollback + 2 credits)
# ==============================================================


def test_mixed_transactions(wallet):
    """
    2 debits, 1 rollback, 2 credits, verify balance after each:
    - Debit 1: balance decreases by amount
    - Debit 2: balance decreases by amount
    - Rollback (for debit 2): balance increases by amount
    - Credit 1 (for debit 1): balance increases by amount
    - Credit 2 (for debit 1): balance increases by amount
    """
    amount = wallet.config.amount
    round_id = random_round_id()

    log("-- Get original balance --")
    original_balance = wallet.fetch_balance()
    log(f"  Original balance: {original_balance}")

    # Debit 1
    print()
    log("-- Debit 1 of 2 --")
    _status, body, debit_txn_1 = wallet.debit(amount, round_id)
    original_balance = wallet.verify_balance_after_debit(
        original_balance, body, amount
    )

    # Debit 2
    print()
    log("-- Debit 2 of 2 --")
    _status, body, debit_txn_2 = wallet.debit(amount, round_id)
    original_balance = wallet.verify_balance_after_debit(
        original_balance, body, amount
    )

    # Rollback for debit 2
    print()
    log("-- Rollback (for debit 2) --")
    _status, body, _rollback_txn = wallet.rollback(
        amount, round_id, sw_bet_transaction_id=debit_txn_2
    )
    original_balance = wallet.verify_balance_after_rollback(
        original_balance, body, amount
    )

    # Credit 1 for debit 1 - first credit, balance should increase
    print()
    log("-- Credit 1 of 2 (for debit 1) --")
    _status, body, credit_txn_1 = wallet.credit(
        amount, round_id, sw_bet_transaction_id=debit_txn_1
    )
    original_balance = wallet.verify_balance_after_credit(
        original_balance, body, amount
    )

    # Credit 2 for debit 1 - duplicate (same transaction_id), balance must NOT change
    print()
    log("-- Credit 2 of 2 (for debit 1) - duplicate, balance must not change --")
    _status, body, _ = wallet.credit(
        amount, round_id, sw_bet_transaction_id=debit_txn_1,
        transaction_id=credit_txn_1,
        assert_success=False,
    )
    response_balance = wallet.extract_balance(body)
    wallet.verify_balance(original_balance, response_balance, "duplicate credit 2 response - balance unchanged")
    fetched = wallet.fetch_balance()
    wallet.verify_balance(original_balance, fetched, "duplicate credit 2 get_balance check")


# ==============================================================
# Test 7: Idempotency
# ==============================================================


def test_idempotency(wallet):
    """
    Verify that resending the same transaction_id does NOT apply the
    operation a second time.  Both responses must return the same balance.

    1. Debit idempotency:
       - debit once  -> balance decreases
       - debit again (same txn_id) -> balance stays the same

    2. Credit idempotency:
       - do a debit first (prerequisite)
       - credit once  -> balance increases
       - credit again (same txn_id) -> balance stays the same

    3. Rollback idempotency:
       - do a debit first (prerequisite)
       - rollback once  -> balance increases
       - rollback again (same txn_id) -> balance stays the same
    """
    amount = wallet.config.amount

    # -- Debit idempotency --
    log("-- Debit Idempotency --")
    round_id = random_round_id()
    txn_id = random_uuid()

    original_balance = wallet.fetch_balance()
    log(f"  Original balance: {original_balance}")

    # First debit
    _status, body1, _ = wallet.debit(amount, round_id, transaction_id=txn_id)
    balance_first = wallet.extract_balance(body1)
    expected = to_decimal(original_balance) - to_decimal(amount)
    wallet.verify_balance(expected, balance_first, "first debit")

    # Re-send same debit (idempotent -- must NOT debit again)
    log("  Re-sending debit with same transaction_id ...")
    _status, body2, _ = wallet.debit(amount, round_id, transaction_id=txn_id)
    balance_second = wallet.extract_balance(body2)
    wallet.verify_balance(
        balance_first, balance_second, "idempotent debit - balance must be same"
    )

    # Confirm via get_balance
    fetched = wallet.fetch_balance()
    wallet.verify_balance(balance_first, fetched, "get_balance after idempotent debit")
    log("  PASSED: debit idempotency")

    # -- Credit idempotency --
    print()
    log("-- Credit Idempotency --")
    round_id = random_round_id()
    debit_txn = random_uuid()

    # Prerequisite debit
    wallet.debit(amount, round_id, transaction_id=debit_txn)
    original_balance = wallet.fetch_balance()
    log(f"  Balance before credit: {original_balance}")

    credit_txn = random_uuid()

    # First credit
    _status, body1, _ = wallet.credit(
        amount, round_id, sw_bet_transaction_id=debit_txn, transaction_id=credit_txn
    )
    balance_first = wallet.extract_balance(body1)
    expected = to_decimal(original_balance) + to_decimal(amount)
    wallet.verify_balance(expected, balance_first, "first credit")

    # Re-send same credit (idempotent)
    log("  Re-sending credit with same transaction_id ...")
    _status, body2, _ = wallet.credit(
        amount, round_id, sw_bet_transaction_id=debit_txn, transaction_id=credit_txn
    )
    balance_second = wallet.extract_balance(body2)
    wallet.verify_balance(
        balance_first, balance_second, "idempotent credit - balance must be same"
    )

    fetched = wallet.fetch_balance()
    wallet.verify_balance(
        balance_first, fetched, "get_balance after idempotent credit"
    )
    log("  PASSED: credit idempotency")

    # -- Rollback idempotency --
    print()
    log("-- Rollback Idempotency --")
    round_id = random_round_id()
    debit_txn = random_uuid()

    # Prerequisite debit
    wallet.debit(amount, round_id, transaction_id=debit_txn)
    original_balance = wallet.fetch_balance()
    log(f"  Balance before rollback: {original_balance}")

    rollback_txn = random_uuid()

    # First rollback
    _status, body1, _ = wallet.rollback(
        amount,
        round_id,
        sw_bet_transaction_id=debit_txn,
        transaction_id=rollback_txn,
    )
    balance_first = wallet.extract_balance(body1)
    expected = to_decimal(original_balance) + to_decimal(amount)
    wallet.verify_balance(expected, balance_first, "first rollback")

    # Re-send same rollback (idempotent)
    log("  Re-sending rollback with same transaction_id ...")
    _status, body2, _ = wallet.rollback(
        amount,
        round_id,
        sw_bet_transaction_id=debit_txn,
        transaction_id=rollback_txn,
    )
    balance_second = wallet.extract_balance(body2)
    wallet.verify_balance(
        balance_first,
        balance_second,
        "idempotent rollback - balance must be same",
    )

    fetched = wallet.fetch_balance()
    wallet.verify_balance(
        balance_first, fetched, "get_balance after idempotent rollback"
    )
    log("  PASSED: rollback idempotency")


# ==============================================================
# Test 8: Error Scenarios
# ==============================================================


def test_errors(wallet):
    """
    Verify the operator returns correct error codes for bad requests.
    Every sub-test runs even if earlier ones fail; failures are collected
    and raised together at the end.

    Our seamless wallet endpoints:
      GET  /accounts/balance/{player_id}
      POST /accounts/transactions/debit
      POST /accounts/transactions/credit
      POST /accounts/transactions/rollback

    Expected operator error codes (all HTTP 400):
      INVALID_API_KEY, TOKEN_EXPIRED, INSUFFICIENT_FUNDS, ACCOUNT_BLOCKED
    """
    amount = wallet.config.amount
    round_id = random_round_id()
    failures = []

    def _run_error_sub(name, fn):
        """Run a single error sub-test; log pass/fail but keep going."""
        try:
            fn()
            log(f"  PASSED: {name}")
        except TestFailure as e:
            log(f"  FAILED: {name} -- {e}")
            failures.append(f"{name}: {e}")
        except Exception as e:
            log(f"  ERROR:  {name} -- {e}")
            failures.append(f"{name}: {e}")

    # -- 1. Get Balance - invalid API key --
    def _err_get_balance_invalid_key():
        log("-- Error: Get Balance with invalid API key --")
        status, body = wallet.get_balance(
            player_session_token=wallet.config.player_session_token,
            api_key=wallet.config.api_key_invalid,
        )
        wallet.verify_error_response(status, body, "INVALID_API_KEY", "get_balance")

    _run_error_sub("Get Balance - invalid API key", _err_get_balance_invalid_key)

    # -- 2. Debit - invalid API key --
    def _err_debit_invalid_key():
        log("-- Error: Debit with invalid API key --")
        status, body, _ = wallet.debit(
            amount, round_id,
            api_key=wallet.config.api_key_invalid,
            assert_success=False,
        )
        wallet.verify_error_response(status, body, "INVALID_API_KEY", "debit")

    print()
    _run_error_sub("Debit - invalid API key", _err_debit_invalid_key)

    # -- 3. Debit - expired session token --
    def _err_debit_expired():
        log("-- Error: Debit with expired session token --")
        balance_before = wallet.fetch_balance()
        log(f"  Balance before: {balance_before}")
        status, body, _ = wallet.debit(
            amount, round_id,
            player_session_token=wallet.config.player_session_token_expired,
            assert_success=False,
        )
        wallet.verify_error_response(status, body, ["TOKEN_EXPIRED", "INVALID_SESSION_TOKEN"], "debit expired")
        balance_after = wallet.fetch_balance()
        wallet.verify_balance(balance_before, balance_after, "balance unchanged after expired session debit")

    print()
    _run_error_sub("Debit - expired session", _err_debit_expired)

    # -- 3b. Debit - invalid session token --
    def _err_debit_invalid_session():
        log("-- Error: Debit with invalid player_session_token --")
        balance_before = wallet.fetch_balance()
        log(f"  Balance before: {balance_before}")
        status, body, _ = wallet.debit(
            amount, round_id,
            player_session_token="invalid-random-token",
            assert_success=False,
        )
        wallet.verify_error_response(status, body, ["TOKEN_EXPIRED", "INVALID_SESSION_TOKEN"], "debit invalid session")
        balance_after = wallet.fetch_balance()
        wallet.verify_balance(balance_before, balance_after, "balance unchanged after invalid session debit")

    print()
    _run_error_sub("Debit - invalid session token", _err_debit_invalid_session)

    # -- 4. Debit - insufficient funds --
    def _err_debit_insufficient():
        log("-- Error: Debit with insufficient funds --")
        balance_before = wallet.fetch_balance()
        log(f"  Balance before: {balance_before}")
        status, body, _ = wallet.debit(
            wallet.config.amount_insufficient_funds, round_id,
            assert_success=False,
        )
        wallet.verify_error_response(
            status, body, "INSUFFICIENT_FUNDS", "debit insufficient"
        )
        balance_after = wallet.fetch_balance()
        wallet.verify_balance(balance_before, balance_after, "balance unchanged after insufficient funds debit")

    print()
    _run_error_sub("Debit - insufficient funds", _err_debit_insufficient)

    # -- 5. Credit - invalid API key --
    def _err_credit_invalid_key():
        log("-- Error: Credit with invalid API key --")
        _s, _b, prereq_debit = wallet.debit(amount, round_id, should_log=False)
        status, body, _ = wallet.credit(
            amount, round_id,
            sw_bet_transaction_id=prereq_debit,
            api_key=wallet.config.api_key_invalid,
            assert_success=False,
        )
        wallet.verify_error_response(status, body, "INVALID_API_KEY", "credit")

    print()
    _run_error_sub("Credit - invalid API key", _err_credit_invalid_key)

    # -- 5b. Credit - invalid session token (must succeed) --
    def _err_credit_invalid_session():
        log("-- Credit with invalid player_session_token (must succeed) --")
        _s, _b, prereq_debit_sess = wallet.debit(amount, round_id, should_log=False)
        original_bal = wallet.fetch_balance()
        log(f"  Balance before: {original_bal}")
        status, body, _ = wallet.credit(
            amount, round_id,
            sw_bet_transaction_id=prereq_debit_sess,
            player_session_token="invalid-random-token",
            assert_success=False,
        )
        test_assert(
            status == 200,
            f"Credit with invalid session should succeed but got HTTP {status}: {body}",
        )
        wallet.verify_balance_after_credit(original_bal, body, amount)

    print()
    _run_error_sub("Credit - invalid session token (must succeed)", _err_credit_invalid_session)

    # -- 6. Rollback - invalid API key --
    def _err_rollback_invalid_key():
        log("-- Error: Rollback with invalid API key --")
        _s, _b, prereq_debit2 = wallet.debit(amount, round_id, should_log=False)
        status, body, _ = wallet.rollback(
            amount, round_id,
            sw_bet_transaction_id=prereq_debit2,
            api_key=wallet.config.api_key_invalid,
            assert_success=False,
        )
        wallet.verify_error_response(status, body, "INVALID_API_KEY", "rollback")

    print()
    _run_error_sub("Rollback - invalid API key", _err_rollback_invalid_key)

    # -- 7. Debit - account blocked (optional) --
    if wallet.config.blocked_player_id:
        def _err_debit_blocked():
            log("-- Error: Debit with blocked player --")
            status, body, _ = wallet.debit(
                amount, round_id,
                player_id=wallet.config.blocked_player_id,
                player_session_token=wallet.config.blocked_player_session_token or None,
                assert_success=False,
            )
            wallet.verify_error_response(
                status, body, "ACCOUNT_BLOCKED", "debit blocked"
            )

        print()
        _run_error_sub("Debit - account blocked", _err_debit_blocked)
    else:
        print()
        log("  Skipping ACCOUNT_BLOCKED test (blocked_player_id not configured)")

    # Raise collected failures at the end so the test is marked as failed
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
    "transactions": (
        "Basic Transactions (2 debits + 1 credit + 1 rollback)",
        test_transactions,
    ),
    "three_debit_one_credit": ("3 Debits + 1 Credit", test_three_debit_one_credit),
    "three_debit_three_credit": (
        "3 Debits + 3 Credits",
        test_three_debit_three_credit,
    ),
    "one_debit_three_credit": ("1 Debit + 3 Credits", test_one_debit_three_credit),
    "mixed_transactions": (
        "Mixed: 2 Debits + 1 Rollback + 2 Credits",
        test_mixed_transactions,
    ),
    "idempotency": (
        "Idempotency (debit / credit / rollback)",
        test_idempotency,
    ),
    "errors": (
        "Error Scenarios (invalid key / expired / insufficient / blocked)",
        test_errors,
    ),
}


def run_test(name, description, func, wallet):
    """Run a single test and return True if passed, False if failed."""
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
    """Run all tests and print a summary."""
    results = {}
    for name, (description, func) in TESTS.items():
        passed = run_test(name, description, func, wallet)
        results[name] = passed

    # Print summary
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
    """Print usage information."""
    test_names = "\n".join(
        f"    {name:30s} - {desc}" for name, (desc, _) in TESTS.items()
    )
    print(
        f"""
Operator API Test Suite - Seamless Wallet Verification

Usage: python run_tests.py <test_name>

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
    wallet = SeamlessWallet(config_path)

    print("Operator API Test Suite - Seamless Wallet Verification")
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
