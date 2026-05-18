# Operator API Test Suite

A standalone Python test suite that verifies an operator's wallet implementation by calling wallet endpoints and validating balance changes, error handling, and idempotency.

The test suite acts as the **Platform** calling the **Operator's** wallet API (outbound direction), matching the contract defined in the OpenAPI spec (`live-casino-operator-api-exposure-and-seamless-wallet-1.1.0`).

Two wallet models are supported:
- **Seamless** -- direct debit/credit per transaction
- **Exposure** -- exposure holds with batch settlement and rollback/resettlement

## Requirements

- **Python 3.6+** (uses f-strings, `uuid`, `decimal`)
- **No external packages required** -- only Python standard library modules are used (`urllib`, `json`, `configparser`, `decimal`, `uuid`)

## Quick Start

```bash
# 1. Edit config.cfg with your operator's wallet details

# 2. Run seamless wallet tests
python3 run_tests.py all

# 3. Run exposure wallet tests
python3 run_exposure_tests.py all

# Or run from the project root
python3 rv_gaming_operator_api_tests/run_tests.py all
python3 rv_gaming_operator_api_tests/run_exposure_tests.py all

# Run a specific test
python3 run_tests.py get_balance
python3 run_exposure_tests.py basic_exposure_settlement
```

## Configuration

Edit `config.cfg` before running. Shared by both seamless and exposure tests.

```ini
[wallet]
wallet_base_url = http://localhost:3000
api_key = MyApiKey
player_session_token = valid-session-token
player_session_token_expired = expired-session-token
player_id = p-123
agent_id = 2
game_id = 1
game_name = Teenpatti One Day
game_type = Live
currency = INR
amount = 10.00

# -- Error Testing --
api_key_invalid = InvalidApiKey
amount_insufficient_funds = 9999999
blocked_player_id =
blocked_player_session_token =
```

---

## Seamless Wallet Tests (`run_tests.py`)

### Available Tests

| Command | Description |
|---|---|
| `get_balance` | Get balance with valid / no / expired session token |
| `transactions` | 2 debits + 1 credit + 1 rollback with balance verification |
| `three_debit_one_credit` | 3 debits then 1 credit |
| `three_debit_three_credit` | 3 debits then 3 credits |
| `one_debit_three_credit` | 1 debit then 3 credits (duplicate credits must not change balance) |
| `mixed_transactions` | 2 debits, 1 rollback, 2 credits |
| `idempotency` | Resend same debit/credit/rollback -- balance must not change twice |
| `errors` | Invalid API key, expired/invalid session, insufficient funds, account blocked |
| `all` | Run all tests above |

### Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/accounts/balance/{player_id}` | Fetch player balance |
| `POST` | `/accounts/transactions/debit` | Debit (bet placement) |
| `POST` | `/accounts/transactions/credit` | Credit (settlement payout) |
| `POST` | `/accounts/transactions/rollback` | Rollback a previous debit |

### Balance Verification

- After debit: `balance = original - amount`
- After credit: `balance = original + amount`
- After rollback: `balance = original + amount`

---

## Exposure Wallet Tests (`run_exposure_tests.py`)

### Available Tests

| Command | Description |
|---|---|
| `get_balance` | Get balance with valid / no / expired session token |
| `basic_exposure_settlement` | Exposure hold + settlement with P/L |
| `exposure_updates` | Multiple exposure updates in a round (version increments) |
| `exposure_settle_rollback` | Exposure + settlement + rollback/resettlement |
| `idempotency` | Same version/transaction_id must not apply twice |
| `errors` | Invalid API key, expired/invalid session, insufficient funds, account blocked |
| `all` | Run all tests above |

### Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/accounts/balance/{player_id}` | Fetch player balance (shared) |
| `POST` | `/accounts/exposure` | Update exposure hold |
| `POST` | `/accounts/settlement` | Batch settlement (release exposure + apply P/L) |
| `POST` | `/accounts/rollback` | Batch rollback / resettlement |

### Balance Verification

- After exposure: `balance = original - exposure`
- After settlement: `balance = balance_before + exposure + pl` (which equals `original + pl`)
- After rollback/resettlement: `balance = balance_before + rollback_pl + new_pl`

### Response Formats

**Exposure success (HTTP 200):**
```json
{"balance": "150.00", "version": 1767810946823}
```

**Settlement / Rollback success (HTTP 200) -- batch response:**
```json
{
  "results": [
    {"player_id": "p-123", "balance": "150.00", "version": 1767810946823}
  ]
}
```

**Error (HTTP 400):**
```json
{"code": "INSUFFICIENT_FUNDS", "message": "...", "balance": "150.00", "version": 123}
```

### Exposure Model Overview

1. Player places bet -> Platform sends **exposure update** to operator
2. Operator holds the exposure amount from the player's balance
3. More bets = updated exposure with higher version (total, not incremental)
4. Round ends -> Platform sends **settlement** (releases exposure, applies P/L)
5. If resettlement needed -> Platform sends **rollback** (reverses old P/L, applies new P/L)

---

## Headers

All requests include:
- `Api-Key` -- Operator-provided API key
- `Player-Session-ID` -- Player session token (omitted for settlement/rollback batch endpoints)
- `Content-Type: application/json`
- `Accept: application/json`

## Expected Error Codes

All errors must return **HTTP 400** with one of:
`INVALID_API_KEY`, `TOKEN_EXPIRED`, `INSUFFICIENT_FUNDS`, `ACCOUNT_BLOCKED`, `REQUEST_DECLINED`, `UNKNOWN_ERROR`

## File Structure

```
rv_gaming_operator_api_tests/
  config.cfg               -- Configuration (edit before running)
  run_tests.py             -- Seamless wallet test scenarios
  seamless_wallet.py       -- API client for seamless endpoints
  run_exposure_tests.py    -- Exposure wallet test scenarios
  exposure_wallet.py       -- API client for exposure endpoints
  utils.py                 -- Logging, config reader, helpers
  README.md                -- This file
```
