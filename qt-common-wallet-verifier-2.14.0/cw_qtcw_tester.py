#!/usr/bin/python

from qtcw import *


def verifysession( qtcw : QTCW):
	log( "Note: testing VerifySession to return the player's currency and balance" )
	qtcw.success_verifysession()

def getbalance( qtcw : QTCW):
	log( "Note: testing GetBalance to return the player's currency and balance" )
	qtcw.success_getbalance()
	qtcw.success_getbalance_without_session()
	qtcw.success_getbalance_expired_session()

def withdrawal( qtcw : QTCW, futureCompatible =0 ):
	log( "Note: performing withdrawal against the wallet platform" )
	amount = qtcw.config.amount
	qtcw.success_withdrawal(amount, randomstr(), randomstr(), randomstr(), futureCompatible)

def deposit( qtcw : QTCW, futureCompatible = 0, shouldLog = True):
	log( "Note: performing deposit against the wallet platform" )
	amount = qtcw.config.amount
	roundid = randomstr()
	txnId = randomstr()
	clientRoundId = randomstr()
	qtcw.success_withdrawal(amount, txnId, roundid, clientRoundId, futureCompatible)
	currentBalance = qtcw.getBalance()

	if shouldLog:
		log( "\n\nNote: Performing tests with valid Wallet-Session Header" )
	originalBalance = qtcw.getBalance()
	jsonresponse = qtcw.success_deposit(amount, randomstr(), roundid, txnId, clientRoundId, futureCompatible)
	balanceAfterTxn = getBalance(jsonresponse)	
	verifyBalanceCredit(originalBalance, balanceAfterTxn, amount, 1)

	print("")
	if shouldLog:
		log("Testing Deposit Expired Wallet Session")
	roundid = randomstr()
	txnId = randomstr()
	betid = randomstr()
	clientRoundId = randomstr()
		
	qtcw.success_withdrawal(amount, betid, roundid,clientRoundId)
	originalBalance = qtcw.getBalance()
	jsonresponse = qtcw.success_deposit_expiredSession(roundid, txnId, betid, clientRoundId, amount)
	balanceAfterTxn = getBalance(jsonresponse)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount)

	deposit_zero_balance(qtcw)
		

def rollback( qtcw : QTCW,  futureCompatible = 0):
	log( "Note: performing rollback against the wallet platform" )
	jsonResponseBalance = qtcw.success_getbalance()
	currentBalance = jsonResponseBalance['balance']

	amount = int(qtcw.config.amount)
	roundid = randomstr()
	clientRoundId = randomstr()
	jsonresponse = qtcw.success_withdrawal(amount, randomstr(), roundid, randomstr())
	referenceid = jsonresponse['referenceId']
	jsonresponse = qtcw.success_rollback(referenceid, amount, randomstr(), roundid, randomstr(), futureCompatible)
	currentBalance = verifyBalanceCredit(qtcw, jsonresponse, currentBalance, amount)
	return jsonresponse

def rollback_v2( qtcw : QTCW, futureCompatible = 0):
	log( "\n\nNote: performing rollback with valid wallet-session header" )
	return rollback_v2_internal(qtcw, futureCompatible, qtcw.config.walletsession)


def rollback_v2_internal( qtcw : QTCW, futureCompatible = 0, walletsession=None):
	originalBalance = getBalance(qtcw.success_getbalance(False))	
	amount = int(qtcw.config.amount)
	roundid = randomstr()
	clientRoundId = randomstr()
	betIdForRollback = randomstr();
	qtcw.success_withdrawal(amount, betIdForRollback, roundid, clientRoundId)	
	jsonresponse = qtcw.success_rollback_v2(betIdForRollback, amount, randomstr(), roundid, clientRoundId, futureCompatible, walletsession)
	balanceAfterTxn = getBalance(jsonresponse)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, decimal.Decimal(str(0)))

	print("")
	log("Performing rollback with expired wallet session")
	originalBalance = getBalance(qtcw.success_getbalance(False))	
	roundid = randomstr()
	clientRoundId = randomstr()
	betIdForRollback = randomstr();
	qtcw.success_withdrawal(amount, betIdForRollback, roundid, clientRoundId)		
	jsonresponse = qtcw.success_rollback_v2_expired_session(betIdForRollback, amount, randomstr(), roundid, clientRoundId, futureCompatible, walletsession)
	balanceAfterTxn = getBalance(jsonresponse)
	verifyBalanceCredit(originalBalance, balanceAfterTxn, decimal.Decimal(str(0)))

	return jsonresponse


def reward( qtcw : QTCW, futureCompatible = 0):
	log( "Note: performing reward against the wallet platform" )
	balanceBeforeTxn = qtcw.getBalance()
	amount = qtcw.config.amount
	txnId = randomstr()
	jsonResponseReward = qtcw.success_reward(amount, txnId, futureCompatible)
	balanceAfterTxn = getBalance(jsonResponseReward)
	verifyBalanceCredit(balanceBeforeTxn, balanceAfterTxn, amount)
		
def three_withdrawals_one_deposit( qtcw : QTCW ):
	print("")
	print("3 Withdrawals then 1 Deposit")
	roundid = randomstr()
	clientRoundId = randomstr()
	amount = float(0.1)
	betid1 = randomstr();
	betid2 = randomstr();
	betid3 = randomstr();
	
	jsonResponseBalance = qtcw.success_getbalance()
	originalBalance = getBalance(jsonResponseBalance)
	
	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid1, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	originalBalance = verifyBalanceDebit(originalBalance, currentBalance, amount)
	
	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid2, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	originalBalance = verifyBalanceDebit(originalBalance, currentBalance, amount)
	
	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid3, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	originalBalance = verifyBalanceDebit(originalBalance, currentBalance, amount)
	
	print("")
	jsonresponseDeposit = qtcw.success_deposit(amount, randomstr(), roundid, betid3, clientRoundId,1, 'true')
	balanceAfterTxn = getBalance(jsonresponseDeposit)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount,1 )
	

def three_withdrawals_three_deposits( qtcw : QTCW ):
	print("")
	print("3 Withdrawals then 3 Deposits")
	roundid = randomstr()
	clientRoundId = randomstr()
	amount = float(0.1)
	betid1 = randomstr();
	betid2 = randomstr();
	betid3 = randomstr();
	
	jsonResponseBalance = qtcw.success_getbalance()
	originalBalance = getBalance(jsonResponseBalance)
	
	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid1, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	originalBalance = verifyBalanceDebit(originalBalance, currentBalance, amount)
	
	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid2, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	originalBalance = verifyBalanceDebit(originalBalance, currentBalance, amount)
	
	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid3, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	originalBalance = verifyBalanceDebit(originalBalance, currentBalance, amount)
	
	jsonresponseDeposit = qtcw.success_deposit(amount, randomstr(), roundid, betid1, clientRoundId,1, 'false')
	balanceAfterTxn = getBalance(jsonresponseDeposit)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount)
	originalBalance = currentBalance
	
	jsonresponseDeposit = qtcw.success_deposit(amount, randomstr(), roundid, betid2, clientRoundId,1, 'false')
	balanceAfterTxn = getBalance(jsonresponseDeposit)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount)
	originalBalance = currentBalance
	
	print("")
	jsonresponseDeposit = qtcw.success_deposit(amount, randomstr(), roundid, betid3, clientRoundId,1, 'true')
	balanceAfterTxn = getBalance(jsonresponseDeposit)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount, 1)
	
	
def one_withdrawal_three_deposits( qtcw : QTCW ):
	print("")
	print("1 withdrawal then 3 deposits")
	roundid = randomstr()
	clientRoundId = randomstr()
	amount = float(0.1)
	betid1 = randomstr();
	
	jsonResponseBalance = qtcw.success_getbalance()
	originalBalance = getBalance(jsonResponseBalance)
	
	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid1, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	originalBalance = verifyBalanceDebit(originalBalance, currentBalance, amount)
		
	jsonresponseDeposit = qtcw.success_deposit(amount, randomstr(), roundid, betid1, clientRoundId,1, 'false')
	balanceAfterTxn = getBalance(jsonresponseDeposit)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount)
	originalBalance = currentBalance
	
	jsonresponseDeposit = qtcw.success_deposit(amount, randomstr(), roundid, betid1, clientRoundId,1, 'false')
	balanceAfterTxn = getBalance(jsonresponseDeposit)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount)
	originalBalance = currentBalance
	
	print("")
	jsonresponseDeposit = qtcw.success_deposit(amount, randomstr(), roundid, betid1, clientRoundId,1, 'true')
	balanceAfterTxn = getBalance(jsonresponseDeposit)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount,1 )


def multiple_transactions( qtcw : QTCW ):
	print("")
	print("Multiple transaction. 2 Withdrawals.  1 Rollback. 2 Deposits.")
	roundid = randomstr()
	clientRoundId = randomstr()
	amount = float(0.1)
	betid1 = randomstr()
	betid2 = randomstr()
	futureCompatible = 0
	
	jsonResponseBalance = qtcw.success_getbalance()
	originalBalance = getBalance(jsonResponseBalance)
	
	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid1, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	originalBalance = verifyBalanceDebit(originalBalance, currentBalance, amount)
	
	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid2, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	
	jsonRollbackResponse = qtcw.success_rollback_v2(betid2, amount, randomstr(), roundid, clientRoundId, futureCompatible, qtcw.config.walletsession, 'false')
	balanceAfterTxn = getBalance(jsonRollbackResponse)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, decimal.Decimal(str(0)))
	
	jsonresponseDeposit = qtcw.success_deposit(amount, randomstr(), roundid, betid1, clientRoundId, 1, 'false')
	balanceAfterTxn = getBalance(jsonresponseDeposit)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount)
	originalBalance = currentBalance
	
	print("")
	jsonresponseDeposit = qtcw.success_deposit(amount, randomstr(), roundid, betid1, clientRoundId,1, 'true')
	balanceAfterTxn = getBalance(jsonresponseDeposit)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount, 1)


def idempotency( qtcw : QTCW ):
	print("")
	qtcw.success_verifysession()
	print("")
	qtcw.success_getbalance()
	print("")
	txnidwithdrawal = randomstr()
	amount = qtcw.config.amount
	roundid = randomstr()
	clientRoundId = randomstr()
	jsonresponsewithdrawal = qtcw.success_withdrawal_idempotency(amount, txnidwithdrawal, roundid, clientRoundId)
	referenceidwithdrawal = jsonresponsewithdrawal['referenceId']
	print("")
	if qtcw.config.rollbackurl:
		txnidrollback = randomstr()
		qtcw.success_rollback_v2_idempotency(txnidwithdrawal, amount, txnidrollback, roundid, clientRoundId)
	else:
		txnidrollback = randomstr()
		qtcw.success_rollback_idempotency(referenceidwithdrawal, amount, txnidrollback, roundid, clientRoundId)
	print("")
	print("")

	print("Testing deposit idempotency")
	roundid = randomstr()
	txniddeposit = randomstr()
	txnidwithdrawal = randomstr()
	clientRoundId = randomstr()
	qtcw.success_withdrawal(amount, txnidwithdrawal, roundid, clientRoundId)
	qtcw.success_deposit_idempotency(amount, txniddeposit, roundid, txnidwithdrawal, clientRoundId, )
	print("")
	print("")

	if qtcw.config.rewardurl:
		log("Testing reward idempotency")
		qtcw.success_reward_idempotency(amount, randomstr())

def futureCompatibility(qtcw : QTCW):
	print("")
	withdrawal(qtcw, 1)
	deposit(qtcw, 1, shouldLog=False)
	if qtcw.config.rollbackurl:		
		rollback_v2( qtcw , 1)
	else:
		rollback( qtcw, 1 )

	if qtcw.config.rewardurl:
		print("")
		reward(qtcw, 1)

def errors( qtcw : QTCW):
	qtcw.error_getbalance_login_failed()
	print("")
	qtcw.error_verifysession_login_failed()
	print("")
	qtcw.error_verifysession_invalid_token()
	print("")
	qtcw.error_verifysession_account_blocked()
	print("")
	qtcw.error_withdrawal_invalid_token()
	print("")
	qtcw.error_withdrawal_expired_token()
	print("")
	qtcw.error_withdrawal_insufficient_funds()
	print("")
	qtcw.error_withdrawal_account_blocked()
	print("")
	qtcw.error_withdrawal_login_failed()
	print("")
	qtcw.error_deposit_login_failed()
	print("")	
	log( "Testing Rollback v2 login failed" )
	if qtcw.config.rollbackurl:
		roundid = randomstr()
		betid = randomstr()
		clientRoundId = randomstr()
		qtcw.success_withdrawal(0.1, betid, roundid,clientRoundId)
		qtcw.error_rollback_v2_login_failed(betid, roundid)
		print("")
		log( "Testing Rollback v2 Transaction not found" )
		qtcw.error_rollback_v2_transaction_not_found(roundid)
	else:
		roundid = randomstr();
		qtcw.error_rollback_login_failed(roundid)
		print("")
		qtcw.error_rollback_transaction_not_found(roundid)
	
	if qtcw.config.rewardurl:
		print("")
		qtcw.error_reward_login_failed()
		print("")
		qtcw.error_reward_request_declined()


def verifyBalanceDebit(originalBalance, balanceAfterTxn, amount):
	jsonResponseBalance = qtcw.success_getbalance(False)
	balanceGetBalance = getBalance(jsonResponseBalance)
	debitedAmount = convertToDecimal(amount)
	qtcw.verifyequalbalance(balanceAfterTxn, balanceGetBalance, originalBalance-debitedAmount)
	return balanceAfterTxn


def verifyBalanceCredit(originalBalance, balanceAfterTxn, amount, completed=0):
	balanceGetBalance = balanceAfterTxn
	if qtcw.config.verifybalanceondeposit or completed:
		jsonResponseBalance = qtcw.success_getbalance(False)
		balanceGetBalance = getBalance(jsonResponseBalance)
	creditedAmount = decimal.Decimal(str(amount))
	qtcw.verifyequalbalance(balanceAfterTxn, balanceGetBalance, originalBalance+creditedAmount)
	return balanceAfterTxn;	
	

def commonwallet( qtcw : QTCW):
	jsonResponseBalance = qtcw.success_getbalance()
	originalBalance = getBalance(jsonResponseBalance)
	print("")
	qtcw.success_verifysession()
	print("")
	roundid = randomstr()
	clientRoundId = randomstr()
	amount = int(qtcw.config.amount)
	betid = randomstr();
	betid2 = randomstr();

	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	originalBalance = verifyBalanceDebit(originalBalance, currentBalance, amount)

	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid2, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	originalBalance = verifyBalanceDebit(originalBalance, currentBalance, amount)
	referenceid = jsonresponseWithdraw['referenceId']

	print("")
	jsonresponseDeposit = qtcw.success_deposit(amount, randomstr(), roundid, betid2, clientRoundId, 1)
	balanceAfterTxn = getBalance(jsonresponseDeposit)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount, 1)
	



	print("")
	if qtcw.config.rollbackurl:		
		originalBalance = getBalance(qtcw.success_getbalance(False))		
		jsonresponse = rollback_v2( qtcw )
		balanceAfterTxn = getBalance(jsonresponse)
		currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, decimal.Decimal(str(0))) # no balance changes
	else:
		rollback( qtcw )

	print("")
	reward(qtcw)
	three_withdrawals_one_deposit( qtcw )
	three_withdrawals_three_deposits( qtcw )
	one_withdrawal_three_deposits( qtcw )
	multiple_transactions( qtcw )


def deposit_zero_balance(qtcw:QTCW):

	print("")
	print("Payout of Zero Amount with completed=true and no bet id")
	roundid = randomstr()
	clientRoundId = randomstr()
	amount = int(qtcw.config.amount)
	betid = randomstr();
	betid2 = randomstr();

	jsonResponseBalance = qtcw.success_getbalance()
	originalBalance = getBalance(jsonResponseBalance)

	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	originalBalance = verifyBalanceDebit(originalBalance, currentBalance, amount)

	jsonresponseWithdraw = qtcw.success_withdrawal(amount, betid2, roundid, clientRoundId)
	currentBalance = getBalance(jsonresponseWithdraw)
	originalBalance = verifyBalanceDebit(originalBalance, currentBalance, amount)
	referenceid = jsonresponseWithdraw['referenceId']

	print("")
	jsonresponseDeposit = qtcw.success_deposit(amount, randomstr(), roundid, betid2, clientRoundId,1, 'false')

	balanceAfterTxn = getBalance(jsonresponseDeposit)	
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount)

	print("")
	jsonresponseDeposit = qtcw.success_deposit(0, randomstr(), roundid, None, clientRoundId,1)
	balanceAfterTxn = getBalance(jsonresponseDeposit)
	currentBalance = verifyBalanceCredit(originalBalance, balanceAfterTxn, amount)



def all( qtcw : QTCW ):
	print ("Performing test: " + method)
	print ("-----------------------")
	getbalance(qtcw)
	print("")
	print("")
	
	print ("Performing test: common wallet")
	print ("-----------------------")
	commonwallet( qtcw )
	print("")
	print("")
	
	print ("Performing test: idempotency")
	print ("-----------------------")
	idempotency( qtcw )
	print("")
	print("")

	print ("Performing test: errors")
	print ("-----------------------")
	errors( qtcw )
	print("")
	print("")

	print ("Performing test: future compatibility")
	print ("-----------------------")
	print("")
	print("")
	futureCompatibility( qtcw )
	print("")
	print("")

	return 0

def getBalance(jsonResponseBalance) :
	balance = jsonResponseBalance['balance']
	return decimal.Decimal(str(balance))

start = datetime.datetime.now()
qtcw = QTCW( "cw_qtcw_tester.cfg" )

print ("This is a script to perform a simple verification of a common wallet")
print ("")

print ("Wallet URL: " + qtcw.config.walleturl)
print ("Session ID: " + qtcw.config.walletsession)
print ("Pass Key: " + qtcw.config.passkey)
print ("")

fail = False

if len( qtcw.config.walletsession ) == 0:
	print ("Please supply a session ID in the file 'cw_qtcw_tester.cfg'")
	fail = True

if qtcw.config.walleturl == "http://enter_url_here":
	print ("Please supply your wallet URL in the file 'cw_qtcw_tester.cfg'")
	fail = True

if fail:
	sys.exit( 0 )

if len( sys.argv ) <= 1:
	fail = True

if len( sys.argv ) >= 2:
	method = sys.argv[1]
	if method != "commonwallet" and \
		method != "verifysession" and \
		method != "getbalance" and \
		method != "idempotency" and \
		method != "withdrawal" and \
		method != "deposit" and \
		method != "rollback" and \
		method != "future" and \
		method != "errors" and \
		method != "reward" and \
		method != "all":
		fail = True

if fail:
	msg = "Usage: " + sys.argv[0] + " <getaccount|gameround|rollback|reward|idempotency|errors|future|all> \n"
	msg+= " commonwallet:\tPerforms a Full Cycle Common Wallet request \n"
	msg+= " verifysession:\tPerforms a Verify Session request \n"
	msg+= " getbalance:\tPerforms a GetBalance request \n"
	msg+= " withdrawal:\tPerforms a Withdrawal request \n"
	msg+= " deposit:\tPerforms a Deposit request \n"
	msg+= " rollback:\tPerforms a GetAccount, GetBalance, Wager and Rollback \n"
	msg+= " reward:\tPerforms a Reward request \n"
	msg+= " idempotency:\tResends a Wager and Result to see that idempotency is working \n"
	msg+= " errors:\tTests multiple error cases to verify the returned error codes \n"
	msg+= " future:\tTests withdrawal, deposit and rollback for future compatibility\n"
	msg+= " all:\t\tPerforms a thorough testing\n"
	print(msg)
	sys.exit( 0 )

if method == "commonwallet":
	print ("Performing test: " + method)
	print ("-----------------------")
	commonwallet( qtcw )
elif method == "verifysession":
	print ("Performing test: " + method)
	print ("-----------------------")
	verifysession( qtcw )
elif method == "getbalance":
	print ("Performing test: " + method)
	print ("-----------------------")
	getbalance(qtcw)
elif method == "withdrawal":
	print ("Performing test: " + method)
	print ("-----------------------")
	withdrawal( qtcw )
elif method == "deposit":
	print ("Performing test: " + method)
	print ("-----------------------")
	deposit( qtcw )
elif method == "rollback":
	if qtcw.config.rollbackurl:
		print ("Performing test: rollback_v2")
		print ("-----------------------")
		rollback_v2( qtcw )
	else:
		print ("Performing test: rollback")
		print ("-----------------------")
		rollback( qtcw )
elif method == "reward":
	print ("Performing test: " + method)
	print ("-----------------------")
	reward( qtcw )
elif method == "idempotency":
	print ("Performing test: " + method)
	print ("-----------------------")
	idempotency( qtcw )
elif method == "errors":
	print ("Performing test: " + method)
	print ("-----------------------")
	errors( qtcw )
elif method == "all":
	print ("Performing test: " + method)
	print ("-----------------------")
	all( qtcw )
elif method == "future":
    print ("Performing tests: " + method)
    print ("-----------------------")
    futureCompatibility(qtcw)

elapsed = datetime.datetime.now() - start



if qtcw.config.error:
	log( "Test NOT successful!" )
elif qtcw.config.warning:
	log( "Test completed with warnings! Common Wallet Tester completed in " + str( elapsed.seconds + (elapsed.days * 24 * 3600) ) + " seconds" )
else:
	log( "Test successful! Common Wallet Tester completed in " + str( elapsed.seconds + (elapsed.days * 24 * 3600) ) + " seconds" )
