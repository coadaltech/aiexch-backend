QT CW Tester v2.0
--------------------
QT CW Tester is a Python script to perform a simple verification of a Operator's common wallet. All CW API methods will be tested, along with various error cases. The testing is not comprehensive - this script is intended to be a tool to aid in the initial verification of an QT CW wallet implementation.

The script is designed to run on a Mac OS X or Linux system, but it should be possible to run the test on Windows as well.


Requirements:
Python version: 3.5.x
Modules: os, sys, datetime, pytz, time, configparser, urllib2, json, decimal

Files contained in the package:
  cw_qtcw_tester.py - The main script
  cw_qtcw_tester.cfg - Configuration for the script
  qtcw.py - Helper functions for the CW communication
  utils.py - General helper functions
  README.txt - Help file

Usage:

- First, modify the cw_qtcw_tester.cfg file and fill in the following
  walleturl - Operator's common wallet base url
  walletsession - The Operator generated player session token
  passkey - The shared secret pass-key.
  playerid - valid Operator's player id
  currency - The currency of the player wallet, as a 3-letter code according to ISO 4217.
  gameid - QT Platform game id.
  device - The device type of the player. Valid values are MOBILE or DESKTOP.
  clienttype - The client type of the game. Valid values are FLASH or HTML5.
  category - The category of the game, expressed as a path.
  completed - Determines whether the game round is finished. true or false
  amount - The amount used in different scenarios
  blockedplayerid - The player id to replicate account blocked error scenario. Leave this value as empty if scenario is not supported
  amounttoreachinsufficientfund - The amount to replicate the insufficient funds scenario in debit
  rewardurl - callback url related to wins outside the regular games.

- Then, run cw_btm_tester.py with one of the following arguments:
  commonwallet - Performs success scenarios for verifysession, getbalance, withdrawal, rollback, deposit and reward
  verifysession	- Performs verify session
  getbalance - Performs GetBalance
  withdrawal - Performs Withdrawal
  deposit - Performs deposit
  rollback - Performs rollback
  reward - Performs reward
  idempotency - Test for idempotency request on Withdrawal, Deposit, Rollback and Reward endpoints
  errors - Tests multiple error cases to verify the returned error codes
  future - Test for future api compatibility. Withdrawal, Deposit, Rollback, Reward endpoints should allow parameters that may be introduced in the future
  all - Will trigger getbalance, common wallet, idempotency errors and future

Example:
    ./cw_qtcw_tester.py all

A successful test run will yield the following result:
2016-03-14 18:31:09.663420	Test successful! Common Wallet Tester completed in 0 seconds

If a critical error is detected, the test will halt after an error message.

If an scenario is does not passed the testing, it will immediately stop the testing process then display an error message, like
2016-03-15 10:39:17.613701	ERROR: Expected error is but actual is no error

Debugging:
   To see the http exchanges - request and response, define an environment varialbe: CW_DEBUG
   Example:
     CW_DEBUG=1 ./cw_qtcw_tester.py all
