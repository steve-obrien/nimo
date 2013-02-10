/* 
 * To change this template, choose Tools | Templates
 * and open the template in the editor.
 */
var Agent = require('./agent.js');

module.exports = function(callback) {
	
	
	
	Agent.error('No mongo data', 'MongoDB');
	
	
	callback(null, {mongo:'data'});
	
	return;
	
	
//def getMongoDBStatus(self):
//		self.mainLogger.debug('getMongoDBStatus: start')
//
//		if 'MongoDBServer' not in self.agentConfig or self.agentConfig['MongoDBServer'] == '':
//			self.mainLogger.debug('getMongoDBStatus: config not set')
//			return False
//
//		self.mainLogger.debug('getMongoDBStatus: config set')
//
//		try:
//			import pymongo
//			from pymongo import Connection
//
//		except ImportError:
//			self.mainLogger.error('Unable to import pymongo library')
//			return False
//
//		# The dictionary to be returned.
//		mongodb = {}
//
//		try:
//			import urlparse
//			parsed = urlparse.urlparse(self.agentConfig['MongoDBServer'])
//
//			mongoURI = ''
//
//			# Can't use attributes on Python 2.4
//			if parsed[0] != 'mongodb':
//
//				mongoURI = 'mongodb://'
//
//				if parsed[2]:
//
//					if parsed[0]:
//
//						mongoURI = mongoURI + parsed[0] + ':' + parsed[2]
//
//					else:
//						mongoURI = mongoURI + parsed[2]
//
//			else:
//
//				mongoURI = self.agentConfig['MongoDBServer']
//
//			self.mainLogger.debug('-- mongoURI: %s', mongoURI)
//
//			conn = Connection(mongoURI, slave_okay=True)
//
//			self.mainLogger.debug('Connected to MongoDB')
//
//		except Exception, ex:
//			import traceback
//			self.mainLogger.error('Unable to connect to MongoDB server %s - Exception = %s', mongoURI, traceback.format_exc())
//			return False
//
//		# Older versions of pymongo did not support the command()
//		# method below.
//		try:
//			db = conn['local']
//
//			# Server status
//			statusOutput = db.command('serverStatus') # Shorthand for {'serverStatus': 1}
//
//			self.mainLogger.debug('getMongoDBStatus: executed serverStatus')
//
//			# Setup
//			import datetime
//			status = {}
//
//			# Version
//			try:
//				status['version'] = statusOutput['version']
//
//				self.mainLogger.debug('getMongoDBStatus: version %s', statusOutput['version'])
//
//			except KeyError, ex:
//				self.mainLogger.error('getMongoDBStatus: version KeyError exception = %s', ex)
//				pass
//
//			# Global locks
//			try:
//				self.mainLogger.debug('getMongoDBStatus: globalLock')
//
//				status['globalLock'] = {}
//				status['globalLock']['ratio'] = statusOutput['globalLock']['ratio']
//
//				status['globalLock']['currentQueue'] = {}
//				status['globalLock']['currentQueue']['total'] = statusOutput['globalLock']['currentQueue']['total']
//				status['globalLock']['currentQueue']['readers'] = statusOutput['globalLock']['currentQueue']['readers']
//				status['globalLock']['currentQueue']['writers'] = statusOutput['globalLock']['currentQueue']['writers']
//
//			except KeyError, ex:
//				self.mainLogger.error('getMongoDBStatus: globalLock KeyError exception = %s', ex)
//				pass
//
//			# Memory
//			try:
//				self.mainLogger.debug('getMongoDBStatus: memory')
//
//				status['mem'] = {}
//				status['mem']['resident'] = statusOutput['mem']['resident']
//				status['mem']['virtual'] = statusOutput['mem']['virtual']
//				status['mem']['mapped'] = statusOutput['mem']['mapped']
//
//			except KeyError, ex:
//				self.mainLogger.error('getMongoDBStatus: memory KeyError exception = %s', ex)
//				pass
//
//			# Connections
//			try:
//				self.mainLogger.debug('getMongoDBStatus: connections')
//
//				status['connections'] = {}
//				status['connections']['current'] = statusOutput['connections']['current']
//				status['connections']['available'] = statusOutput['connections']['available']
//
//			except KeyError, ex:
//				self.mainLogger.error('getMongoDBStatus: connections KeyError exception = %s', ex)
//				pass
//
//			# Extra info (Linux only)
//			try:
//				self.mainLogger.debug('getMongoDBStatus: extra info')
//
//				status['extraInfo'] = {}
//				status['extraInfo']['heapUsage'] = statusOutput['extra_info']['heap_usage_bytes']
//				status['extraInfo']['pageFaults'] = statusOutput['extra_info']['page_faults']
//
//			except KeyError, ex:
//				self.mainLogger.debug('getMongoDBStatus: extra info KeyError exception = %s', ex)
//				pass
//
//			# Background flushing
//			try:
//				self.mainLogger.debug('getMongoDBStatus: backgroundFlushing')
//
//				status['backgroundFlushing'] = {}
//				delta = datetime.datetime.utcnow() - statusOutput['backgroundFlushing']['last_finished']
//				status['backgroundFlushing']['secondsSinceLastFlush'] = delta.seconds
//				status['backgroundFlushing']['lastFlushLength'] = statusOutput['backgroundFlushing']['last_ms']
//				status['backgroundFlushing']['flushLengthAvrg'] = statusOutput['backgroundFlushing']['average_ms']
//
//			except KeyError, ex:
//				self.mainLogger.debug('getMongoDBStatus: backgroundFlushing KeyError exception = %s', ex)
//				pass
//
//			# Per second metric calculations (opcounts and asserts)
//			try:
//				if self.mongoDBStore == None:
//					self.mainLogger.debug('getMongoDBStatus: per second metrics no cached data, so storing for first time')
//					self.setMongoDBStore(statusOutput)
//
//				else:
//					self.mainLogger.debug('getMongoDBStatus: per second metrics cached data exists')
//
//					accessesPS = float(statusOutput['indexCounters']['btree']['accesses'] - self.mongoDBStore['indexCounters']['btree']['accessesPS']) / 60
//
//					if accessesPS >= 0:
//						status['indexCounters'] = {}
//						status['indexCounters']['btree'] = {}
//						status['indexCounters']['btree']['accessesPS'] = accessesPS
//						status['indexCounters']['btree']['hitsPS'] = float(statusOutput['indexCounters']['btree']['hits'] - self.mongoDBStore['indexCounters']['btree']['hitsPS']) / 60
//						status['indexCounters']['btree']['missesPS'] = float(statusOutput['indexCounters']['btree']['misses'] - self.mongoDBStore['indexCounters']['btree']['missesPS']) / 60
//						status['indexCounters']['btree']['missRatioPS'] = float(statusOutput['indexCounters']['btree']['missRatio'] - self.mongoDBStore['indexCounters']['btree']['missRatioPS']) / 60
//
//						status['opcounters'] = {}
//						status['opcounters']['insertPS'] = float(statusOutput['opcounters']['insert'] - self.mongoDBStore['opcounters']['insertPS']) / 60
//						status['opcounters']['queryPS'] = float(statusOutput['opcounters']['query'] - self.mongoDBStore['opcounters']['queryPS']) / 60
//						status['opcounters']['updatePS'] = float(statusOutput['opcounters']['update'] - self.mongoDBStore['opcounters']['updatePS']) / 60
//						status['opcounters']['deletePS'] = float(statusOutput['opcounters']['delete'] - self.mongoDBStore['opcounters']['deletePS']) / 60
//						status['opcounters']['getmorePS'] = float(statusOutput['opcounters']['getmore'] - self.mongoDBStore['opcounters']['getmorePS']) / 60
//						status['opcounters']['commandPS'] = float(statusOutput['opcounters']['command'] - self.mongoDBStore['opcounters']['commandPS']) / 60
//
//						status['asserts'] = {}
//						status['asserts']['regularPS'] = float(statusOutput['asserts']['regular'] - self.mongoDBStore['asserts']['regularPS']) / 60
//						status['asserts']['warningPS'] = float(statusOutput['asserts']['warning'] - self.mongoDBStore['asserts']['warningPS']) / 60
//						status['asserts']['msgPS'] = float(statusOutput['asserts']['msg'] - self.mongoDBStore['asserts']['msgPS']) / 60
//						status['asserts']['userPS'] = float(statusOutput['asserts']['user'] - self.mongoDBStore['asserts']['userPS']) / 60
//						status['asserts']['rolloversPS'] = float(statusOutput['asserts']['rollovers'] - self.mongoDBStore['asserts']['rolloversPS']) / 60
//
//						self.setMongoDBStore(statusOutput)
//					else:
//						self.mainLogger.debug('getMongoDBStatus: per second metrics negative value calculated, mongod likely restarted, so clearing cache')
//						self.setMongoDBStore(statusOutput)
//
//			except KeyError, ex:
//				self.mainLogger.error('getMongoDBStatus: per second metrics KeyError exception = %s', ex)
//				pass
//
//			# Cursors
//			try:
//				self.mainLogger.debug('getMongoDBStatus: cursors')
//
//				status['cursors'] = {}
//				status['cursors']['totalOpen'] = statusOutput['cursors']['totalOpen']
//
//			except KeyError, ex:
//				self.mainLogger.error('getMongoDBStatus: cursors KeyError exception = %s', ex)
//				pass
//
//			# Replica set status
//			if 'MongoDBReplSet' in self.agentConfig and self.agentConfig['MongoDBReplSet'] == 'yes':
//				self.mainLogger.debug('getMongoDBStatus: get replset status too')
//
//				# isMaster (to get state
//				isMaster = db.command('isMaster')
//
//				self.mainLogger.debug('getMongoDBStatus: executed isMaster')
//
//				status['replSet'] = {}
//				status['replSet']['setName'] = isMaster['setName']
//				status['replSet']['isMaster'] = isMaster['ismaster']
//				status['replSet']['isSecondary'] = isMaster['secondary']
//
//				if 'arbiterOnly' in isMaster:
//					status['replSet']['isArbiter'] = isMaster['arbiterOnly']
//
//				self.mainLogger.debug('getMongoDBStatus: finished isMaster')
//
//				# rs.status()
//				db = conn['admin']
//				replSet = db.command('replSetGetStatus')
//
//				self.mainLogger.debug('getMongoDBStatus: executed replSetGetStatus')
//
//				status['replSet']['myState'] = replSet['myState']
//
//				status['replSet']['members'] = {}
//
//				for member in replSet['members']:
//
//					self.mainLogger.debug('getMongoDBStatus: replSetGetStatus looping %s', member['name'])
//
//					status['replSet']['members'][str(member['_id'])] = {}
//
//					status['replSet']['members'][str(member['_id'])]['name'] = member['name']
//					status['replSet']['members'][str(member['_id'])]['state'] = member['state']
//
//					# Optime delta (only available from not self)
//					# Calculation is from http://docs.python.org/library/datetime.html#datetime.timedelta.total_seconds
//					if 'optimeDate' in member: # Only available as of 1.7.2
//						deltaOptime = datetime.datetime.utcnow() - member['optimeDate']
//						status['replSet']['members'][str(member['_id'])]['optimeDate'] = (deltaOptime.microseconds + (deltaOptime.seconds + deltaOptime.days * 24 * 3600) * 10**6) / 10**6
//
//					if 'self' in member:
//						status['replSet']['myId'] = member['_id']
//
//					# Have to do it manually because total_seconds() is only available as of Python 2.7
//					else:
//						if 'lastHeartbeat' in member:
//							deltaHeartbeat = datetime.datetime.utcnow() - member['lastHeartbeat']
//							status['replSet']['members'][str(member['_id'])]['lastHeartbeat'] = (deltaHeartbeat.microseconds + (deltaHeartbeat.seconds + deltaHeartbeat.days * 24 * 3600) * 10**6) / 10**6
//
//					if 'errmsg' in member:
//						status['replSet']['members'][str(member['_id'])]['error'] = member['errmsg']
//
//			# db.stats()
//			if 'MongoDBDBStats' in self.agentConfig and self.agentConfig['MongoDBDBStats'] == 'yes':
//				self.mainLogger.debug('getMongoDBStatus: db.stats() too')
//
//				status['dbStats'] = {}
//
//				for database in conn.database_names():
//
//					if database != 'config' and database != 'local' and database != 'admin' and database != 'test':
//
//						self.mainLogger.debug('getMongoDBStatus: executing db.stats() for %s', database)
//
//						status['dbStats'][database] = conn[database].command('dbstats')
//						status['dbStats'][database]['namespaces'] = conn[database]['system']['namespaces'].count()
//
//						# Ensure all strings to prevent JSON parse errors. We typecast on the server
//						for key in status['dbStats'][database].keys():
//
//							status['dbStats'][database][key] = str(status['dbStats'][database][key])
//
//
//		except Exception, ex:
//			import traceback
//			self.mainLogger.error('Unable to get MongoDB status - Exception = %s', traceback.format_exc())
//			return False
//
//		self.mainLogger.debug('getMongoDBStatus: completed, returning')
//
//		return status
//
//	def setMongoDBStore(self, statusOutput):
//		self.mongoDBStore = {}
//
//		self.mongoDBStore['indexCounters'] = {}
//		self.mongoDBStore['indexCounters']['btree'] = {}
//		self.mongoDBStore['indexCounters']['btree']['accessesPS'] = statusOutput['indexCounters']['btree']['accesses']
//		self.mongoDBStore['indexCounters']['btree']['hitsPS'] = statusOutput['indexCounters']['btree']['hits']
//		self.mongoDBStore['indexCounters']['btree']['missesPS'] = statusOutput['indexCounters']['btree']['misses']
//		self.mongoDBStore['indexCounters']['btree']['missRatioPS'] = statusOutput['indexCounters']['btree']['missRatio']
//
//		self.mongoDBStore['opcounters'] = {}
//		self.mongoDBStore['opcounters']['insertPS'] = statusOutput['opcounters']['insert']
//		self.mongoDBStore['opcounters']['queryPS'] = statusOutput['opcounters']['query']
//		self.mongoDBStore['opcounters']['updatePS'] = statusOutput['opcounters']['update']
//		self.mongoDBStore['opcounters']['deletePS'] = statusOutput['opcounters']['delete']
//		self.mongoDBStore['opcounters']['getmorePS'] = statusOutput['opcounters']['getmore']
//		self.mongoDBStore['opcounters']['commandPS'] = statusOutput['opcounters']['command']
//
//		self.mongoDBStore['asserts'] = {}
//		self.mongoDBStore['asserts']['regularPS'] = statusOutput['asserts']['regular']
//		self.mongoDBStore['asserts']['warningPS'] = statusOutput['asserts']['warning']
//		self.mongoDBStore['asserts']['msgPS'] = statusOutput['asserts']['msg']
//		self.mongoDBStore['asserts']['userPS'] = statusOutput['asserts']['user']
//		self.mongoDBStore['asserts']['rolloversPS'] = statusOutput['asserts']['rollovers']
		
}