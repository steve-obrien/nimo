var exec = require('child_process').exec;
var _ = require('underscore');
var http = require('http');
var async = require('async');
var config = require('config');
var mysql = require('mysql');

/**
 * Agent is a silent process on a server that monitors various server metrics.
 */
function Agent() {
	console.log('oi');
}


Agent.prototype.doChecks = function () {
    async.parallel({
        apacheStatus   : _.bind(this.getApacheStatus, this),
        diskUseage     : _.bind(this.getDiskUsage, this),
        loadAvrgs      : _.bind(this.getLoadAvrgs, this),
        memory         : _.bind(this.getMemoryUsage, this),
        mysqlStatus    : _.bind(this.getMySqlStatus, this),
        networkTraffic : _.bind(this.getNetworkTraffic, this),
        processes      : _.bind(this.getProcesses, this),
        ioStats        : _.bind(this.getIoStats, this),
        cpuStats       : _.bind(this.getCpuStats, this)
    },
    function(err, results) {
        console.log(results)
        console.log('!!!FINISHED FUNCTIONS!!!');
    });
}

Agent.prototype.run = function (timeFreq) {
    this.timeFreq = timeFreq || 10000;
    // Do the checks
    this.doChecks();
    setInterval(_.bind(this.doChecks, this), this.timeFreq);
};

/**
 * Get apache stats
 */
Agent.prototype.getApacheStatus = function (callback) {
    //callback(null, 'oi');return;
	this.log('getApacheStatus: start');
	
	var statusUrl = 'http://127.0.0.1/server-status/?auto';
	
	this.log('getApacheStatus: config set');
	this.log('getApacheStatus: attempting urlopen');
	
	var processAacheStatus = _.bind(function (response) {
		var str = '';
		if (response.statusCode !== 200) {
            this.error('Unable to get Apache status');
            callback(null, '');
        }
		
		response.on('error', _.bind(function (e) {
			this.error('Unable to get Apache status - HTTPError ' + e.message);
		}, this));
		
		response.on('data', function (chunk) {
			str += chunk;
		});

		//the whole response has been recieved
		response.on('end', _.bind(function () {

			// split out each line
			var lines = str.split('\n'),
                apacheStatus = {};
			
			this.log('getApacheStatus: parsing, loop');
			
			for (i = 0; i < lines.length; i++) {
				var values = lines[i].split(': ');
				if (values.length == 2)
				    apacheStatus[values[0]] = values[1];
			}
			//this.log(apacheStatus);
			this.log('getApacheStatus: parsed');
            
            apacheStatusReturn = {};
            // the stats are in the format since the server was started.
            // we really want them per minutes so...
            if (apacheStatus['Total Accesses'] !== undefined) {
                var totalAccesses = apacheStatus['Total Accesses'];
                if (this.apacheTotalAccesses === undefined || this.apacheTotalAccesses <= 0 || totalAccesses <= 0) {
                    apacheStatusReturn['reqPerSec'] = 0.0;
                    apacheStatusReturn['bytesPerSec'] = 0.0;
                    this.apacheTotalAccesses = totalAccesses;
                } else {
                    apacheStatusReturn['reqPerSec'] = (totalAccesses - this.apacheTotalAccesses) / 60
                    this.apacheTotalAccesses = totalAccesses
                }
            } else {
                this.error('getApacheStatus: Total Accesses not present in mod_status output. Is ExtendedStatus enabled?')  
            }
            
            if (apacheStatus['BusyWorkers'] !== undefined && apacheStatus['IdleWorkers'] !== undefined) {
                apacheStatusReturn['busyWorkers'] = apacheStatus['BusyWorkers'];
                apacheStatusReturn['idleWorkers'] = apacheStatus['idleWorkers'];
            } else {
                this.error('getApacheStatus: BusyWorkers/IdleWorkers not present in mod_status output. Is the URL correct (must have ?auto at the end)?');
            }
            
            // carefull these stats may be misleading as they are an average of across all requests and time
            // since the apache server was started
            if (apacheStatus['BytesPerReq'] !== undefined && apacheStatus['BytesPerSec'] !== undefined) {
                apacheStatusReturn['bytesPerReq'] = apacheStatus['BytesPerReq'];
                apacheStatusReturn['bytesPerSec'] = apacheStatus['BytesPerSec'];
            }
            
            if (_.isEmpty(apacheStatusReturn)) {
                this.error('No apache stats available');
                callback(null, '');
            }
            
            callback(null, apacheStatusReturn);
            
		}, this));
	}, this);

	http.request(statusUrl, processAacheStatus).end();
    
};

Agent.prototype.getDiskUsage = function (callback) {
	this.log('getDiskUsage: start');
	exec('df -k', _.bind(function (error, df, stderr) {
		
		this.log('getDiskUsage: Popen success, start parsing');

		// Split out each volume
		volumes = df.split('\n');
		
		this.log('getDiskUsage: parsing, split');

		// Remove first (headings) and last (blank) lines
		volumes.shift();
		volumes.pop();
		
		this.log('getDiskUsage: parsing, pop');

		var usageData = [];

		// Set some defaults
		var previousVolume = null;
		var volumeCount = 0;
		
		this.log('getDiskUsage: parsing, start loop');

		var reg = /([0-9]+)/;
		
		var totalAvail = 0, totalUsed = 0;
		_.each(volumes, function (volume) {
			
			this.log('getDiskUsage: parsing volume:' + volume);
			// Split out the string
			var vol = volume.split(/\s+/);
			if (reg.exec(vol[1]) != null && reg.exec(vol[2]) != null && reg.exec(vol[3]) != null) {
				vol[2] = vol[2] / 1024 / 1024; // Used
				vol[3] = vol[3] / 1024 / 1024; // Available
				totalUsed += vol[2];
				totalAvail += vol[3];
				usageData.push(vol);
			}
			
		}, this);
		
		this.log('getDiskUsage: completed, returning');
		usageData.push(['total', totalUsed, totalAvail]);
		this.log(usageData);
		
        callback(null, usageData);
        
	}, this));
	
};

Agent.prototype.getMySqlStatus = function(callback){
	this.log('getMySQLStatus: start');
    
    if (_.isUndefined(config.mysql.host) || _.isUndefined(config.mysql.user)) {
        this.error('getMySQLStatus: config not set');
        callback(null, null);
    }
    
    var db = mysql.createConnection(config.mysql); 
    db.connect();
    db.on('error', _.bind(function(err) {
        this.error(err.code + ' ' + err); 
        callback(null, null); 
    }, this));
                                  
    var mysqlStats = {};
        
    // Get MySQL version
    if (this.mysqlVersion === undefined) {
        this.log('getMySQLStatus: mysqlVersion unset storing for first time');
        
        db.query('SELECT VERSION() as v', _.bind(function(err, rows, fields) {
            if (err) throw err;
            var version = rows[0]['v'];
            version = version.split('-');
            version = version[0].split('.')
            // may have to loop through each version number int in the array to ensure it is a number
            // but for now we'll stuff it in.
            mysqlStats.mysqlVersion = this.mysqlVersion = version;
            
        }, this));
    }
   
    
    // Connections per second
    db.query('SHOW STATUS LIKE "Connections"', _.bind(function(err, rows, fields) {
        if (err) throw err;
        
        if (this.mysqlConnectionsStore === undefined) {
            this.log('getMySQLStatus: mysqlConnectionsStore unset storing for first time');
            this.mysqlConnectionsStore = rows[0]['Value'];
            mysqlStats.connections = 0;
        } else {
            this.log('getMySQLStatus: mysqlConnectionsStore set so calculating');
            this.log('getMySQLStatus: self.mysqlConnectionsStore = ' + this.mysqlConnectionsStore);
            this.log('getMySQLStatus: result = ' + rows[1]);
            console.log(rows[0]['Value']);
            console.log(this.mysqlConnectionsStore)
            mysqlStats.connections = parseFloat(parseFloat(rows[0]['Value']) - parseFloat(this.mysqlConnectionsStore)) / this.timeFreq;
            this.mysqlConnectionsStore = rows[0]['Value'];
        }
			
    }, this));
        
    // Created_tmp_disk_tables
        
    // Determine query depending on version. For 5.02 and above we need the GLOBAL keyword
     
    if (this.mysqlVersion !== undefined) {
        var query = '';
        if (this.mysqlVersion[0] >= 5 && this.mysqlVersion[2] >= 2) {
            console.log('greater than 5!');
            query = 'SHOW GLOBAL STATUS LIKE "Created_tmp_disk_tables"';
        } else {
            query = 'SHOW STATUS LIKE "Created_tmp_disk_tables"';
        }
        db.query(query, function (err, rows, fields) {
            mysqlStats.createdTmpDiskTables = parseFloat(rows[0]['Value']);
            
            callback(null, mysqlStats);
        });
    }
        
        
    console.log(this.timeFreq);
    db.end();
        
        
    

//    mysqlStats.createdTmpDiskTables = createdTmpDiskTables
//    'maxUsedConnections' : maxUsedConnections, 
//    'openFiles' : openFiles,
//    'slowQueries' : slowQueries, 
//    'tableLocksWaited' : tableLocksWaited, 
//    'threadsConnected' : threadsConnected, 
//    'secondsBehindMaster' : secondsBehindMaster
    

//
//			
//
//			# Max_used_connections
//			try:
//				cursor = db.cursor()
//				cursor.execute('SHOW STATUS LIKE "Max_used_connections"')
//				result = cursor.fetchone()
//
//			except MySQLdb.OperationalError, message:
//
//				self.mainLogger.error('getMySQLStatus: MySQL query error when getting Max_used_connections = %s', message)
//
//			maxUsedConnections = result[1]
//
//			self.mainLogger.debug('getMySQLStatus: maxUsedConnections = %s', createdTmpDiskTables)
//
//			self.mainLogger.debug('getMySQLStatus: getting Max_used_connections - done')
//
//			self.mainLogger.debug('getMySQLStatus: getting Open_files')
//
//			# Open_files
//			try:
//				cursor = db.cursor()
//				cursor.execute('SHOW STATUS LIKE "Open_files"')
//				result = cursor.fetchone()
//
//			except MySQLdb.OperationalError, message:
//
//				self.mainLogger.error('getMySQLStatus: MySQL query error when getting Open_files = %s', message)
//
//			openFiles = result[1]
//
//			self.mainLogger.debug('getMySQLStatus: openFiles = %s', openFiles)
//
//			self.mainLogger.debug('getMySQLStatus: getting Open_files - done')
//
//			self.mainLogger.debug('getMySQLStatus: getting Slow_queries')
//
//			# Slow_queries
//
//			# Determine query depending on version. For 5.02 and above we need the GLOBAL keyword (case 31015)
//			if int(self.mysqlVersion[0]) >= 5 and int(self.mysqlVersion[2]) >= 2:
//				query = 'SHOW GLOBAL STATUS LIKE "Slow_queries"'
//
//			else:
//				query = 'SHOW STATUS LIKE "Slow_queries"'
//
//			try:
//				cursor = db.cursor()
//				cursor.execute(query)
//				result = cursor.fetchone()
//
//			except MySQLdb.OperationalError, message:
//
//				self.mainLogger.error('getMySQLStatus: MySQL query error when getting Slow_queries = %s', message)
//
//			if self.mysqlSlowQueriesStore == None:
//
//				self.mainLogger.debug('getMySQLStatus: mysqlSlowQueriesStore unset so storing for first time')
//
//				self.mysqlSlowQueriesStore = result[1]
//
//				slowQueries = 0
//
//			else:
//
//				self.mainLogger.debug('getMySQLStatus: mysqlSlowQueriesStore set so calculating')
//				self.mainLogger.debug('getMySQLStatus: self.mysqlSlowQueriesStore = %s', self.mysqlSlowQueriesStore)
//				self.mainLogger.debug('getMySQLStatus: result = %s', result[1])
//
//				slowQueries = float(float(result[1]) - float(self.mysqlSlowQueriesStore)) / 60
//
//				self.mysqlSlowQueriesStore = result[1]
//
//			self.mainLogger.debug('getMySQLStatus: slowQueries = %s', slowQueries)
//
//			self.mainLogger.debug('getMySQLStatus: getting Slow_queries - done')
//
//			self.mainLogger.debug('getMySQLStatus: getting Table_locks_waited')
//
//			# Table_locks_waited
//			try:
//				cursor = db.cursor()
//				cursor.execute('SHOW STATUS LIKE "Table_locks_waited"')
//				result = cursor.fetchone()
//
//			except MySQLdb.OperationalError, message:
//
//				self.mainLogger.error('getMySQLStatus: MySQL query error when getting Table_locks_waited = %s', message)
//
//			tableLocksWaited = float(result[1])
//
//			self.mainLogger.debug('getMySQLStatus: tableLocksWaited  = %s', tableLocksWaited)
//
//			self.mainLogger.debug('getMySQLStatus: getting Table_locks_waited - done')
//
//			self.mainLogger.debug('getMySQLStatus: getting Threads_connected')
//
//			# Threads_connected
//			try:
//				cursor = db.cursor()
//				cursor.execute('SHOW STATUS LIKE "Threads_connected"')
//				result = cursor.fetchone()
//
//			except MySQLdb.OperationalError, message:
//
//				self.mainLogger.error('getMySQLStatus: MySQL query error when getting Threads_connected = %s', message)
//
//			threadsConnected = result[1]
//
//			self.mainLogger.debug('getMySQLStatus: threadsConnected = %s', threadsConnected)
//
//			self.mainLogger.debug('getMySQLStatus: getting Threads_connected - done')
//
//			self.mainLogger.debug('getMySQLStatus: getting Seconds_Behind_Master')
//
//			if 'MySQLNoRepl' not in self.agentConfig:
//				# Seconds_Behind_Master
//				try:
//					cursor = db.cursor(MySQLdb.cursors.DictCursor)
//					cursor.execute('SHOW SLAVE STATUS')
//					result = cursor.fetchone()
//
//				except MySQLdb.OperationalError, message:
//
//					self.mainLogger.error('getMySQLStatus: MySQL query error when getting SHOW SLAVE STATUS = %s', message)
//					result = None
//
//				if result != None:
//					try:
//						secondsBehindMaster = result['Seconds_Behind_Master']
//
//						self.mainLogger.debug('getMySQLStatus: secondsBehindMaster = %s', secondsBehindMaster)
//
//					except IndexError, e:
//						secondsBehindMaster = None
//
//						self.mainLogger.debug('getMySQLStatus: secondsBehindMaster empty. %s', e)
//
//				else:
//					secondsBehindMaster = None
//
//					self.mainLogger.debug('getMySQLStatus: secondsBehindMaster empty. Result = None.')
//
//				self.mainLogger.debug('getMySQLStatus: getting Seconds_Behind_Master - done')
//
//			return {'connections' : connections, 'createdTmpDiskTables' : createdTmpDiskTables, 'maxUsedConnections' : maxUsedConnections, 'openFiles' : openFiles, 'slowQueries' : slowQueries, 'tableLocksWaited' : tableLocksWaited, 'threadsConnected' : threadsConnected, 'secondsBehindMaster' : secondsBehindMaster}
//
//		else:
//
//			self.mainLogger.debug('getMySQLStatus: config not set')
//			return False
    
    
};

Agent.prototype.getCpuStats = function (callback) {
//	this.log('getCpuStats: start');
//    
//    cpuStats = {};
//    if (process.env.platform == 'linux') {
//        this.log('getCPUStats: linux');
//        headerRegexp =/.*?([%][a-zA-Z0-9]+)[\s+]?/;  re.compile(r'.*?([%][a-zA-Z0-9]+)[\s+]?')
//        itemRegexp = /.*?\s+(\d+)[\s+]?/;
//		valueRegexp = /'\d+\.\d+/
//		proc = null;
//    }
    
//			try:
//				proc = subprocess.Popen(['mpstat', '-P', 'ALL', '1', '1'], stdout=subprocess.PIPE, close_fds=True)
//				stats = proc.communicate()[0]
//
//				if int(pythonVersion[1]) >= 6:
//					try:
//						proc.kill()
//					except Exception, e:
//						self.mainLogger.debug('Process already terminated')
//
//				stats = stats.split('\n')
//				header = stats[2]
//				headerNames = re.findall(headerRegexp, header)
//				device = None
//
//				for statsIndex in range(4, len(stats)): # skip "all"
//					row = stats[statsIndex]
//
//					if not row: # skip the averages
//						break
//
//					deviceMatch = re.match(itemRegexp, row)
//
//					if deviceMatch is not None:
//						device = 'CPU%s' % deviceMatch.groups()[0]
//
//					values = re.findall(valueRegexp, row.replace(',', '.'))
//
//					cpuStats[device] = {}
//					for headerIndex in range(0, len(headerNames)):
//						headerName = headerNames[headerIndex]
//						cpuStats[device][headerName] = values[headerIndex]
//
//			except OSError, ex:
//				# we dont have it installed return nothing
//				return False
//
//			except Exception, ex:
//				if int(pythonVersion[1]) >= 6:
//					try:
//						if proc:
//							proc.kill()
//					except UnboundLocalError, e:
//						self.mainLogger.debug('Process already terminated')
//					except Exception, e:
//						self.mainLogger.debug('Process already terminated')
//
//				import traceback
//				self.mainLogger.error('getCPUStats: exception = %s', traceback.format_exc())
//				return False
//		else:
//			self.mainLogger.debug('getCPUStats: unsupported platform')
//			return False
//
//		self.mainLogger.debug('getCPUStats: completed, returning')
//		return cpuStats
    
    callback(null, 'cpu stats');
};

Agent.prototype.getIoStats = function (callback) {
	this.log('getIoStats: start');
    callback(null, 'io stats');
};

Agent.prototype.getLoadAvrgs = function (callback) {
    this.log('getLoadAvrgs: start');
    callback(null, 'load avrgs stats');
};

Agent.prototype.getMemoryUsage = function (callback) {
	this.log('getMemoryUsage: start');
    callback(null, 'mem stats');
};

Agent.prototype.getNetworkTraffic = function (callback) {
	this.log('getNetworkTraffic: start');
    callback(null, 'network stats');
};

Agent.prototype.getProcesses = function (callback) {
	this.log('getProcesses: start');
    callback(null, 'processes');
};

Agent.prototype.log = function (msg) {
	//console.log(msg);
};

Agent.prototype.error = function (msg) {
	console.log(msg);
};


module.exports = new Agent();