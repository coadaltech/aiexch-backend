from utils import *
import datetime, pytz, time, decimal
import urllib.request

def verifykeyexist(json, key, dataType=None) :

	if key not in json:
		error("Error validating json field %s. Not present!" %(key))
	value = json[key]
	if dataType is float:
		if not isinstance(value, float) and not isinstance(value, int):
			actual = type(value)
			error("Invalid data type for field '%s' Expected: %s actual: %s" %(key, dataType,actual))
	elif dataType is not None:		
		if not isinstance(value, dataType):
			actual = type(value)
			error("Invalid data type for field '%s' Expected: %s actual: %s" %(key, dataType,actual))
	
	return


def convertToDecimal(source):
		return decimal.Decimal(str(source))


def verifyequalbalancereferenceid(jsonresponse1, jsonresponse2) :
	balance1 = jsonresponse1['balance']
	referenceid1 = jsonresponse1['referenceId']

	balance2 = jsonresponse2['balance']
	referenceid2 = jsonresponse2['referenceId']

	notmatchedmessage = ""

	if convertToDecimal(balance1) != convertToDecimal(balance2):
		notmatchedmessage += "Balance do not match. %s != %s " %(balance1, balance2)

	if referenceid1!=referenceid2:
		notmatchedmessage += "Reference id do not match %s != %s " %(referenceid1, referenceid2)

	if len(notmatchedmessage) > 0:
			error(notmatchedmessage)
	return

def expectedErrorToErrorCode(expectederror):
    if expectederror == "loginfailed":
	    return "LOGIN_FAILED"
    elif expectederror == "invalidtoken":
        return "INVALID_TOKEN"
    elif expectederror == "accountblocked":
        return "ACCOUNT_BLOCKED"
    elif expectederror == "insufficientfunds":
        return "INSUFFICIENT_FUNDS"
    elif expectederror == "requestdeclined":
        return "REQUEST_DECLINED"
    elif expectederror == "transactionnotfound":
        return "TRANSACTION_NOT_FOUND"
    else:
	    return "unrecognized expectederror";

class QTCW:
	def __init__( self, filename ):
		self.config = Config( filename )
		self.config.error = False
		self.config.warning = False
		self.config.resend = False

		return

	def getDateTime(self):
		tz = pytz.timezone('Asia/Shanghai')								
		dt = datetime.datetime.now(tz)
		createdDateTime = '%s[%s]' % (str(dt.isoformat( timespec='milliseconds')), tz)
		return createdDateTime


	def verifyequalbalance(self, balanceAfterTxn, balanceGetBalance, expectedBalance) :		
		notmatchedmessage = ""
		if balanceAfterTxn != balanceGetBalance: 
			notmatchedmessage += "Balance After Txn and Get Balance Does Not Match %s !=  %s " %(balanceAfterTxn, balanceGetBalance)
		elif (balanceAfterTxn != expectedBalance):
			notmatchedmessage += "Balance After Txn Is Not Expected: Expected: %s Actual:  %s " %(expectedBalance, balanceAfterTxn)
		
		if len(notmatchedmessage) > 0:
			error(notmatchedmessage)
		return


	def checkresponse(self, response, request, expectederror, shouldLog=True):			
		httpcode = response.getcode()		
		if shouldLog:						
			log("Http status code is %s"  %(httpcode))
		try:
			jsonresponse = json.loads(str(response.read(), "utf-8"))
			log("Response body is %s" %(jsonresponse))		
				
			if not "application/json" in response.getheader("Content-Type"):
				error("Content-Type header must be application/json, actual: %s"  %(response.getheader("Content-Type")))
			if httpcode >= 400:
				self.checkerrorresponse(httpcode, jsonresponse, request, expectederror)
			elif httpcode <=299 and bool(expectederror):
				errorCode = expectedErrorToErrorCode(expectederror)
				error("Expected error is %s but actual is no error" %(str(errorCode)))		
			else:
				self.checksuccessfulresponse(jsonresponse, request)
		except Exception as e:			
			error("Failed to parse response JSON: %s %s" %(response , e))
		return jsonresponse

	def checksuccessfulresponse(self, jsonresponse, request):
		if request == "verifysession":
			return self.checkverifysession(jsonresponse)
		elif request == "getbalance":
			return self.checkgetbalance(jsonresponse)
		elif request == "withdrawal":
			return self.checkwithdrawal(jsonresponse)
		elif request == "deposit":
			return self.checkwithdrawal(jsonresponse)
		elif request == "rollback":
			return self.checkrollback(jsonresponse)

	def checkerrorresponse(self, httpcode, jsonresponse, request, expectederror):
		if expectederror == "loginfailed":
			return self.checkerrorcodeandmessage(httpcode, jsonresponse, 401, "LOGIN_FAILED")
		elif expectederror == "invalidtoken":
			return self.checkerrorcodeandmessage(httpcode, jsonresponse, 400, "INVALID_TOKEN")
		elif expectederror == "accountblocked":
			return self.checkerrorcodeandmessage(httpcode, jsonresponse, 403, "ACCOUNT_BLOCKED")
		elif expectederror == "insufficientfunds":
			return self.checkerrorcodeandmessage(httpcode, jsonresponse, 400, "INSUFFICIENT_FUNDS")
		elif expectederror == "requestdeclined":
			return self.checkerrorcodeandmessage(httpcode, jsonresponse, 400, "REQUEST_DECLINED")
		elif expectederror == "transactionnotfound":
			return self.checkerrorcodeandmessage(httpcode, jsonresponse, 404, "TRANSACTION_NOT_FOUND")
		else:
			error("Unhandled error, this must have checking: status=%s body=%s" %(httpcode, jsonresponse))

	def checkerrorcodeandmessage(self, actualhttpcode, actualjsonresponse,
								 expectedhttpcode, expectederrorcode):
		actualerrorcode = actualjsonresponse['code'].upper()

		notmatchedmessage = ""

		if actualhttpcode != expectedhttpcode:
			notmatchedmessage += "Expected http code is %s but actual is %s" %(expectedhttpcode, actualhttpcode) 
		if actualerrorcode != expectederrorcode:
			notmatchedmessage += "Expected error code is %s but actual is %s" %(expectederrorcode, actualerrorcode)

		if len(notmatchedmessage) > 0:
			error(notmatchedmessage)

	def checkverifysession( self, root ):
		verifykeyexist(root, "balance", float )
		verifykeyexist(root, "currency", str )
		return

	def checkgetbalance( self, root ):
		verifykeyexist(root, "balance", float)
		verifykeyexist(root, "currency", str )
		return

	def checkwithdrawal( self, root ):
		verifykeyexist(root, "balance", float)
		verifykeyexist(root, "referenceId", str )
		return

	def checkrollback( self, root ):
		verifykeyexist(root, "balance", float )
		verifykeyexist(root, "referenceId", str )
		return

	def checkrollback_transaction_not_found( self, root ):
		verifykeyexist(root, "balance", float )
		return

	def checkrollback_v2( self, root ):
		verifykeyexist(root, "balance", float )
		verifykeyexist(root, "referenceId", str )
		return

	def prepareurl(self, request, vars):
		if request == "getbalance" or request == "getbalance_expired_session":
			return self.config.walleturl + "accounts/" + urllib.parse.quote(vars['playerid']) +"/balance?gameId=" + vars['gameid']
		elif request == "getbalance_without_session":
			return self.config.walleturl + "accounts/" + urllib.parse.quote(vars['playerid']) +"/balance"
		elif request == "verifysession":
			return self.config.walleturl + "accounts/" + urllib.parse.quote(vars['playerid']) +"/session?gameId=" + vars['gameid']
		elif request == "withdrawal" :
			return self.config.withdrawurl
		elif request == "deposit":
			return self.config.depositurl
		elif request == "rollback":
			return self.config.walleturl + "transactions/" +vars['referenceid'] +"/rollback"
		elif request == "rollback_v2":
			return self.config.rollbackurl;
		elif request == "reward":
			return self.config.rewardurl;
	
	def success_verifysession( self ):
		log( "Testing VerifySession" )
		vars = {}
		vars['playerid'] = self.config.playerid
		vars['gameid'] = self.config.gameid
		customheaders = {'Pass-Key':self.config.passkey, 'Wallet-Session':self.config.walletsession}
		self.__execute_rest("verifysession", vars, customheaders, {}, {})
		return

	def error_getbalance_login_failed(self):
		log( "Testing Get balance request declined" )

		vars = {}
		vars['playerid'] = self.config.playerid
		vars['gameid'] = self.config.gameid
		customheaders = {'Pass-Key':randomstr()}
		self.__execute_rest("getbalance", vars, customheaders, {}, "loginfailed")
		return

	def error_verifysession_login_failed( self ):
		log( "Testing Verify session login failed" )

		vars = {}
		vars['playerid'] = self.config.playerid
		vars['gameid'] = self.config.gameid
		customheaders = {'Pass-Key':randomstr(), 'Wallet-Session':self.config.walletsession}
		self.__execute_rest("verifysession", vars, customheaders, {}, "loginfailed")
		return

	def error_verifysession_invalid_token( self ):
		log( "Testing Verify session invalid token" )

		vars = {}
		vars['playerid'] = self.config.playerid
		vars['gameid'] = self.config.gameid
		customheaders = {'Pass-Key':self.config.passkey, 'Wallet-Session':randomstr()}
		self.__execute_rest("verifysession", vars, customheaders, {}, "invalidtoken")
		return

	def error_verifysession_account_blocked( self ):
		
		if (self.config.blockedplayerid == ""):
			return
	

		log( "Testing Verify session account blocked" )

		vars = {}
		vars['playerid'] = self.config.blockedplayerid
		vars['gameid'] = self.config.gameid
		customheaders = {'Pass-Key':self.config.passkey, 'Wallet-Session':self.config.blockedwalletsession}
		self.__execute_rest("verifysession", vars, customheaders, {}, "accountblocked")
		return

	def error_withdrawal_insufficient_funds( self ):
		log("Testing Withdrawal insufficient funds")

		amount = self.config.amounttoreachinsufficientfund
		log( "Testing Withdrawal with amount of " +str(amount))
		customheaders = {'Pass-Key':self.config.passkey, 'Wallet-Session':self.config.walletsession}
		body = {}
		body['txnType'] = "DEBIT"
		body['txnId'] = randomstr()
		body['playerId'] = self.config.playerid
		body['roundId'] = randomstr()
		body['amount'] = float(amount)
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = self.config.completed
		body['created'] = self.getDateTime()

		jsonresponse = self.__execute_rest("withdrawal", vars, customheaders, body, "insufficientfunds")
		return jsonresponse

    
	def error_withdrawal_account_blocked( self ):

		if (self.config.blockedplayerid == ""):
			return
	

		
		log("Testing Withdrawal account blocked")

		amount = 1
		log( "Testing Withdrawal with amount of %s" %(amount))
		customheaders = {'Pass-Key':self.config.passkey, 'Wallet-Session':self.config.blockedwalletsession}
		body = {}
		body['txnType'] = "DEBIT"
		body['txnId'] = randomstr()
		body['playerId'] = self.config.blockedplayerid
		body['roundId'] = randomstr()
		body['amount'] = amount
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = self.config.completed
		body['created'] = self.getDateTime()

		jsonresponse = self.__execute_rest("withdrawal", vars, customheaders, body, "accountblocked")
		return jsonresponse

	def error_withdrawal_invalid_token( self ):
		log("Testing Withdrawal invalid token")

		amount = 1
		log( "Testing Withdrawal with amount of %s" %(amount))
		customheaders = {'Pass-Key':self.config.passkey, 'Wallet-Session':randomstr()}
		body = {}
		body['txnType'] = "DEBIT"
		body['txnId'] = randomstr()
		body['playerId'] = self.config.playerid
		body['roundId'] = randomstr()
		body['amount'] = amount
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = self.config.completed
		body['created'] = self.getDateTime()

		jsonresponse = self.__execute_rest("withdrawal", vars, customheaders, body, "invalidtoken")
		return jsonresponse

	def error_withdrawal_login_failed( self ):
		log("Testing Withdrawal login failed")

		amount = 1
		log( "Testing Withdrawal with amount of %s" %(amount))
		customheaders = {'Pass-Key':randomstr(), 'Wallet-Session':self.config.walletsession}
		body = {}
		body['txnType'] = "DEBIT"
		body['txnId'] = randomstr()
		body['playerId'] = self.config.playerid
		body['roundId'] = randomstr()
		body['amount'] = amount
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = self.config.completed
		body['created'] = self.getDateTime()

		jsonresponse = self.__execute_rest("withdrawal", vars, customheaders, body, "loginfailed")

	def error_withdrawal_expired_token( self ):
		log("Testing Withdrawal expired wallet session")

		amount = 1
		log( "Testing Withdrawal with amount of %s" %(amount))
		customheaders = {'Pass-Key':self.config.passkey, 'Wallet-Session':self.config.walletsessionExpired}
		body = {}
		body['txnType'] = "DEBIT"
		body['txnId'] = randomstr()
		body['playerId'] = self.config.playerid
		body['roundId'] = randomstr()
		body['amount'] = amount
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = self.config.completed
		body['created'] = self.getDateTime()

		jsonresponse = self.__execute_rest("withdrawal", vars, customheaders, body, "invalidtoken")

	
	def error_deposit_login_failed( self):
		log("Testing Deposit login failed")
		roundid = randomstr()
		betid = randomstr()
		clientRoundId = randomstr()
		amount = 0.1
		self.success_withdrawal(amount, betid, roundid,clientRoundId)
		


		customheaders = {'Pass-Key':randomstr()}
		customheaders['Wallet-Session'] = self.config.walletsession
		body = {}
		body['txnType'] = "DEBIT"
		body['txnId'] = randomstr()
		body['playerId'] = self.config.playerid
		body['roundId'] = randomstr()
		body['amount'] = amount
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = self.config.completed
		body['created'] = self.getDateTime()

		jsonresponse = self.__execute_rest("deposit", vars, customheaders, body, "loginfailed")

	def success_deposit_expiredSession( self, roundId, txnId, betId, clientRoundId, amount, completed='true' ):

		log("Performing Deposit Expired Wallet Session")


		customheaders = {'Pass-Key':self.config.passkey}
		customheaders['Wallet-Session'] = self.config.walletsessionExpired
		body = {}
		body['txnType'] = "CREDIT"
		body['txnId'] = txnId
		body['playerId'] = self.config.playerid
		body['roundId'] = roundId
		body['betId'] = betId
		body['clientRoundId'] = clientRoundId
		body['amount'] = float(amount)
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = completed
		body['created'] = self.getDateTime()

		jsonresponse = self.__execute_rest("deposit", vars, customheaders, body, {})
		return jsonresponse


	def error_rollback_login_failed ( self, roundid, completed='true' ):
		log( "Testing Rollback login failed" )

		amount = float(self.config.amount)
		jsonresponse = self.success_withdrawal(amount, randomstr(), roundid, randomstr())
		referenceid = jsonresponse['referenceId']
		log("Rollback reference id of %s and amount of %s" %(referenceid, amount))
		customheaders = {'Pass-Key':randomstr()}

		vars = {}
		vars['referenceid'] = referenceid

		body = {}
		body['txnId'] = randomstr()
		body['playerId'] = self.config.playerid
		body['roundId'] = randomstr()
		body['amount'] = amount
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = completed
		body['created'] = self.getDateTime()

		jsonresponse = self.__execute_rest("rollback", vars, customheaders, body, "loginfailed")
		return jsonresponse

	def error_rollback_v2_login_failed ( self, betid, roundid, completed='true' ):
		amount = float(self.config.amount)
		jsonresponse = self.success_withdrawal(amount, betid, roundid, randomstr())
		referenceid = jsonresponse['referenceId']
		log("Rollback reference id of %s and amount of %s" %(referenceid, amount))		
		customheaders = {'Pass-Key':randomstr()}
		customheaders['Wallet-Session'] = self.config.walletsession

		vars = {}
		vars['referenceid'] = betid

		body = {}
		body['betId'] = betid
		body['txnId'] = randomstr()
		body['playerId'] = self.config.playerid
		body['roundId'] = roundid
		body['amount'] = amount
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = completed
		body['created'] = self.getDateTime()

		jsonresponse = self.__execute_rest("rollback_v2", vars, customheaders, body, "loginfailed")
		return jsonresponse

	def error_rollback_transaction_not_found ( self, roundid, completed='true' ):
		log( "Testing Rollback transaction not found" )

		amount = float(self.config.amount)
		referenceid = randomstr()		
		log("Rollback reference id of %s and amount of %s" %(referenceid, amount))
		customheaders = {'Pass-Key':self.config.passkey}
		customheaders['Wallet-Session'] = self.config.walletsession

		vars = {}
		vars['referenceid'] = referenceid

		body = {}
		body['txnId'] = randomstr()
		body['playerId'] = self.config.playerid
		body['roundId'] = randomstr()
		body['amount'] = amount
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = completed
		body['created'] = self.getDateTime()

		jsonresponse = self.__execute_rest("rollback", vars, customheaders, body, {})
		self.checkrollback_transaction_not_found(jsonresponse)

		return jsonresponse

	def error_rollback_v2_transaction_not_found ( self, roundid, completed='true' ):
		amount = float(self.config.amount)
		betid = randomstr()
		roundId = randomstr()
		txnId = randomstr()	

		log("Rollback bet id of %s and amount of %s roundId: %s txnId: %s" %(betid, amount, roundId, txnId))

		customheaders = {'Pass-Key':self.config.passkey}
		customheaders['Wallet-Session'] = self.config.walletsession

		vars = {}
		vars['referenceid'] = betid

		body = {}
		body['betId'] = betid
		body['txnId'] = txnId
		body['playerId'] = self.config.playerid
		body['roundId'] = roundId
		body['amount'] = amount
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = completed
		body['created'] = self.getDateTime()
		
		jsonresponse = self.__execute_rest("rollback_v2", vars, customheaders, body, {})
		self.checkrollback_transaction_not_found(jsonresponse)

		return jsonresponse

	def success_getbalance( self, shouldLog=True ):
		if shouldLog:
			log( "Testing GetBalance" )
		else:
			log("GetBalance")
		vars = {}
		vars['playerid'] = self.config.playerid
		vars['gameid'] = self.config.gameid
		customheaders = {'Pass-Key':self.config.passkey, 'Wallet-Session':self.config.walletsession}
		return self.__execute_rest("getbalance", vars, customheaders, {}, {}, shouldLog)

	def success_getbalance_without_session(self, shouldLog=True ):
		if shouldLog:
			log( "Testing GetBalance with Without Wallet-Session and Game Id" )
		else:
			log("GetBalance")
		vars = {}
		vars['playerid'] = self.config.playerid
		customheaders = {'Pass-Key':self.config.passkey}
		return self.__execute_rest("getbalance_without_session", vars, customheaders, {}, {}, shouldLog)

	def success_getbalance_expired_session(self, shouldLog=True ):
		if shouldLog:
			log( "Testing GetBalance with Expired Wallet-Session and Game Id" )
		else:
			log("GetBalance")
		vars = {}
		vars['playerid'] = self.config.playerid
		vars['gameid'] = self.config.gameid
		customheaders = {'Pass-Key':self.config.passkey, 'Wallet-Session':self.config.walletsessionExpired}
		return self.__execute_rest("getbalance_expired_session", vars, customheaders, {}, {}, shouldLog)	
		

	def success_withdrawal_idempotency(self, amount, txnid, roundid, clientRoundId):
		log( "Note: performing a withdrawal against the wallet platform" )
		jsonResponseBalance = self.success_getbalance(False)
		originalBalance = self.getBalance(jsonResponseBalance)
		
		jsonresponsefirst = self.success_withdrawal(amount, txnid, roundid, clientRoundId)
		balanceAfterTxn = self.getBalance(jsonresponsefirst)		
		balanceGetBalance = self.getBalance(self.success_getbalance(False))
		self.verifyequalbalance(balanceAfterTxn, balanceGetBalance, originalBalance -convertToDecimal(amount))

		

		log( "Note: re-sending the withdrawal with the same transaction ID" )
		jsonresponsesecond = self.success_withdrawal(amount, txnid, roundid, clientRoundId)
		balanceAfterTxn = self.getBalance(jsonresponsesecond)		
		balanceGetBalance = self.getBalance()
		self.verifyequalbalance(balanceAfterTxn, balanceGetBalance, originalBalance - convertToDecimal(amount))


		verifyequalbalancereferenceid(jsonresponsefirst, jsonresponsesecond)
		return jsonresponsefirst

	def success_deposit_idempotency(self, amount, txnid, roundid, betid, clientRoundId):
		log( "Note: performing a deposit against the wallet platform" )
		originalBalance = self.getBalance()	
		jsonresponsefirst = self.success_deposit(amount, txnid, roundid, betid, clientRoundId)
		balanceAfterTxn = self.getBalance(jsonresponsefirst)
		balanceGetBalance = self.getBalance()
		amountChanged = originalBalance + convertToDecimal(amount)
		self.verifyequalbalance(balanceAfterTxn, balanceGetBalance, amountChanged)

		log( "Note: re-sending the deposit with the same transaction ID" )
		jsonresponsesecond = self.success_deposit(amount, txnid, roundid, betid, clientRoundId)
		balanceAfterTxn = self.getBalance(jsonresponsesecond)		
		self.verifyequalbalance(balanceAfterTxn, balanceGetBalance, amountChanged)

		verifyequalbalancereferenceid(jsonresponsefirst, jsonresponsesecond)
		return jsonresponsefirst

	def success_rollback_idempotency(self, referenceid, amount, txnid, roundid, clientRoundId):
		log( "Note: performing a rollback against the wallet platform" )
		jsonresponsefirst = self.success_rollback(referenceid, amount, txnid, roundid, clientRoundId)

		log( "Note: re-sending the rollback with the same transaction ID" )
		jsonresponsesecond = self.success_rollback(referenceid, amount, txnid, roundid, clientRoundId)

		verifyequalbalancereferenceid(jsonresponsefirst, jsonresponsesecond)
		return jsonresponsefirst

	def success_rollback_v2_idempotency(self, betid, amount, txnid, roundid, clientRoundId):
		print("==================")
		log( "Note: performing a rollback v2 against the wallet platform" )
		originalBalance = self.getBalance()		
		jsonresponsefirst = self.success_rollback_v2(betid, amount, txnid, roundid, clientRoundId)
		balanceAfterTxn = self.getBalance(jsonresponsefirst)
		balanceGetBalance = self.getBalance()
		amountChanged = originalBalance + convertToDecimal(amount)
		self.verifyequalbalance(balanceAfterTxn, balanceGetBalance , amountChanged)

		log( "Note: re-sending the rollback v2 with the same transaction ID" )
		jsonresponsesecond = self.success_rollback_v2(betid, amount, txnid, roundid, clientRoundId)
		balanceAfterTxn = self.getBalance(jsonresponsesecond)
		balanceGetBalance = self.getBalance()
		self.verifyequalbalance(balanceAfterTxn, balanceGetBalance, amountChanged)

		verifyequalbalancereferenceid(jsonresponsefirst, jsonresponsesecond)
		return jsonresponsefirst

	def success_withdrawal(self, amount, txnid, roundid, clientRoundId, futureCompatible = 0):		
		log( "Testing Withdrawal with amount of %s and txnid of %s roundid : %s clientRoundId: %s" %(amount, txnid, roundid, clientRoundId))
		customheaders = {'Pass-Key':self.config.passkey, 'Wallet-Session':self.config.walletsession}
		body = {}
		body['txnType'] = "DEBIT"
		body['txnId'] = txnid
		body['playerId'] = self.config.playerid
		body['roundId'] = roundid
		body['clientRoundId'] = clientRoundId
		body['amount'] = float(amount)
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = self.config.completed
		body['created'] = self.getDateTime()
	
		if  futureCompatible:
		    body['dummy']  = randomstr()

		jsonresponse = self.__execute_rest("withdrawal", vars, customheaders, body, {})
		return jsonresponse

	def success_deposit( self, amount, txnid, roundid, betId, clientRoundId, futureCompatible=0, completed='true' ):
		log( "Testing Deposit with amount of %s, completed = %s" %(amount, completed))
		customheaders = {'Pass-Key':self.config.passkey}
		customheaders['Wallet-Session'] = self.config.walletsession
		
		body = {}
		body['txnType'] = "CREDIT"
		body['txnId'] = txnid
		body['playerId'] = self.config.playerid
		body['roundId'] = roundid
		body['clientRoundId'] = clientRoundId
		body['amount'] = float(amount)
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = completed
		body['created'] = self.getDateTime()

		if betId is not None:
			body['betId'] = betId
		if  futureCompatible:
		    body['dummy']  = randomstr()
		jsonresponse = self.__execute_rest("deposit", vars, customheaders, body, {})
		return jsonresponse

	def success_rollback( self, referenceid, amount, txnid, roundid, clientRoundId, futureCompatible=0, completed='true' ):
		log( "Testing Rollback" )		
		log("Rollback reference id of %s and amount of %s" %(referenceid, amount))
		customheaders = {'Pass-Key':self.config.passkey}
		customheaders['Wallet-Session'] = self.config.walletsession

		vars = {}
		vars['referenceid'] = referenceid

		body = {}
		body['txnId'] = randomstr()
		body['playerId'] = self.config.playerid
		body['roundId'] = roundid
		body['clientRoundId'] = clientRoundId
		body['amount'] = float(amount)
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = completed
		body['created'] = self.getDateTime()

		if  futureCompatible:
		    body['dummy']  = randomstr()
		jsonresponse = self.__execute_rest("rollback", vars, customheaders, body, {})
		return jsonresponse

	def success_rollback_v2( self, betid, amount, txnid, roundid, clientRoundId, futureCompatible=0, walletsession=None, completed='true' ):
		log( "Testing Rollback v2" )
		log("Rollback v2 bet id of %s and amount of %s" %(betid, amount))
		customheaders = {'Pass-Key':self.config.passkey}
		customheaders['Wallet-Session'] = self.config.walletsession

		vars = {}
		vars['referenceid'] = betid

		body = {}
		body['betId'] = betid
		body['txnId'] = txnid
		body['playerId'] = self.config.playerid
		body['roundId'] = roundid
		body['clientRoundId'] = clientRoundId
		body['amount'] = float(amount)
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = completed
		body['created'] = self.getDateTime()
        
		
		if  futureCompatible:
		    body['dummy']  = randomstr()
		jsonresponse = self.__execute_rest("rollback_v2", vars, customheaders, body, {})
		self.checkrollback_v2(jsonresponse)
		return jsonresponse

	def success_rollback_v2_expired_session( self, betid, amount, txnid, roundid, clientRoundId, futureCompatible=0, walletsession=None, completed='true' ):
		log( "Testing Rollback v2 with expired session" )
		customheaders = {'Pass-Key':self.config.passkey}
		customheaders['Wallet-Session'] = self.config.walletsessionExpired

		vars = {}
		vars['referenceid'] = betid

		body = {}
		body['betId'] = betid
		body['txnId'] = txnid
		body['playerId'] = self.config.playerid
		body['roundId'] = roundid
		body['clientRoundId'] = clientRoundId
		body['amount'] = float(amount)
		body['currency'] = self.config.currency
		body['gameId'] = self.config.gameid
		body['device'] = self.config.device
		body['clientType'] = self.config.clienttype
		body['category'] = self.config.category
		body['completed'] = completed
		body['created'] = self.getDateTime()

        
		
		if  futureCompatible:
		    body['dummy']  = randomstr()
		jsonresponse = self.__execute_rest("rollback_v2", vars, customheaders, body, {})
		return jsonresponse


	def success_reward(self, amount, txnid, futureCompatible = 0):
		log( "Testing Reward with amount of %s and txnid of %s" %(amount, txnid))
		customheaders = {'Pass-Key':self.config.passkey}
		return self.reward(amount, txnid, futureCompatible, customheaders, {})	

	def reward(self, amount, txnid, futureCompatible = 0, customheaders = {}, expectederror= {}):
		body = {}
		body['rewardType'] = "TOURNAMENT_REWARD"
		body['rewardTitle'] = "Thunderkick Championship"		
		body['txnId'] = txnid
		body['playerId'] = self.config.playerid
		body['amount'] = float(amount)
		body['currency'] = self.config.currency
		body['created'] = self.getDateTime()

		if  futureCompatible:
		    body['dummy']  = randomstr()

		jsonresponse = self.__execute_rest("reward", {}, customheaders, body, expectederror)
		return jsonresponse	


	def success_reward_idempotency(self, amount, txnid):
		log( "Note: performing a reward against the wallet platform" )
		balanceBeforeTxn = self.getBalance(self.success_getbalance(False))

		jsonResponseFirst = self.success_reward(amount, txnid)
		balanceAfterTxn = self.getBalance(jsonResponseFirst)
		jsonResponseGetBalance = self.getBalance(self.success_getbalance(False))

		self.verifyequalbalance(balanceAfterTxn, jsonResponseGetBalance, balanceBeforeTxn + convertToDecimal(amount))
		
		log( "Note: re-sending the reward with the same transaction ID" )

		jsonResponseSecond = self.success_reward(amount, txnid)
		balanceAfterTxn = self.getBalance(jsonResponseSecond)
		jsonResponseGetBalance = self.getBalance(self.success_getbalance(False))
		self.verifyequalbalance(balanceAfterTxn, jsonResponseGetBalance, balanceBeforeTxn + convertToDecimal(amount))

		verifyequalbalancereferenceid(jsonResponseFirst, jsonResponseSecond)
		return jsonResponseFirst

	def error_reward_login_failed(self):
		log( "Testing Reward login failed" )
		return self.reward(4, randomstr(), 0, {}, "loginfailed")

	def error_reward_request_declined(self):
		log( "Testing Reward request. A required field is missing." )
		customheaders = {'Pass-Key':self.config.passkey}

		body = {}
		body['rewardTitle'] = "Thunderkick Championship"		
		body['txnId'] = randomstr()
		body['playerId'] = self.config.playerid
		body['amount'] = float(100)
		body['currency'] = self.config.currency
		body['created'] = self.getDateTime()

		jsonresponse = self.__execute_rest("reward", {}, customheaders, body, "requestdeclined")
		return jsonresponse	

	def __execute_rest( self, operation, vars, customheaders, payload, expectederror, shouldLog=True):
		reqline = self.prepareurl( operation ,vars )
		response = dorequest( reqline, customheaders, payload )
		jsonresponse = self.checkresponse( response, operation, expectederror, shouldLog)
		return jsonresponse
	
	
	def getBalance(self, jsonResponse=None):
		if jsonResponse is None:
			jsonResponse = self.success_getbalance(False)
		balance = jsonResponse['balance']
		return convertToDecimal(balance)
