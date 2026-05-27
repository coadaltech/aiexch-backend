import os
import sys
import datetime
import configparser
import urllib
import urllib.request
import urllib.parse
import urllib.error
import json
from random import choice
from string import ascii_uppercase

def log( msg ):
	now = datetime.datetime.now()
	print (str(now) + "\t" + msg)
	return

def error( msg ):
	log( "ERROR: " + msg )
	sys.exit( 1 )
	return

def warning( msg ):
	log( "WARNING: " + msg )
	return

class Config:
	def getoption( self, config, section, option ):
		if config.has_option( section, option ) == False:
			error( "Config option '" + option + "' in section '" + section + "' not found" )
		return config.get( section, option )

	def __init__( self, filename ):
		if os.path.exists( filename ) == False:
			error( "Config file '" + filename + "' not found" )
		config = configparser.ConfigParser()
		config.read( filename )
		vars = [ "walleturl", "rollbackurl","walletsession", "passkey", 
		"playerid", "currency", "gameid", "device", "clienttype", "category", "completed", "amount", 
		"blockedplayerid", "amounttoreachinsufficientfund", "blockedwalletsession", "walletsessionExpired", 
		"rewardurl", "depositurl", "withdrawurl", "verifybalanceondeposit"]
		for var in vars:
			eval( 'setattr( self, "' + var + '", self.getoption( config, "wallet", "' + var + '" ) )' )

def 	dorequest(reqline, customheaders, payload):
	try:
		headervalue = {'Accept':'application/json','User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Safari/537.36'}
		headervalue.update(customheaders)

		if(len(payload) > 0):			
		    data = json.dumps(payload)
		    headervalue['Content-Type'] = 'application/json'
		    req = urllib.request.Request( url=reqline, data=data.encode(), headers=headervalue)
		else:
			req = urllib.request.Request( url=reqline, headers=headervalue)
		httpHandler = urllib.request.HTTPSHandler()
		if "CW_DEBUG" in os.environ:
			httpHandler.set_http_debuglevel(1)			
		opener = urllib.request.build_opener(httpHandler)
		urllib.request.install_opener(opener)
		response = urllib.request.urlopen(req)
	except urllib.error.HTTPError as err:
		response = err
	except AttributeError as err:
		response = err	
	except TypeError as err:
		response = err		
		print(str(err) + "=-------------------")
	except:
		error( "Failed to connect to: " + str( sys.exc_info()[0]) +  reqline )
	return response

def randomstr():
	str = ''.join(choice(ascii_uppercase) for i in range(12))
	return str