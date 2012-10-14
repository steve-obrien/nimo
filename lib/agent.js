var exec = require('child_process').exec;
var _ = require('underscore');
var http = require('http');
var async = require('async');
var config = require('config');
var mysql = require('mysql');
var fs = require('fs');
var request = require('request');
var yaml = require('js-yaml'); // lots of output is in this format (or can be parsed by it)
var os = require('os');


/**
 * Agent is a silent process on a server that monitors various server metrics.
 */
function Agent() {}


Agent.prototype.doChecks = function () {
    // store an object of errors encoutered on this journey.
    this.errors = [];
    
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
    _.bind(function(err, results) {
 
//        console.log(results);
          console.log('!!!FINISHED FUNCTIONS!!!');
//        console.log('Errors:');
//        console.log(this.errors);
        // post the results
        this.post(results);
        
    }, this));
}
    
Agent.prototype.getSystemInfo = function () {
        
    var system = {};
    system.platform = os.platform();
    system.hostname = os.hostname();
    // cpu architecture
    system.arch = os.arch();
    system.release = os.release();
    // uptime in seconds
    system.uptime = os.uptime();
    
    system.totalmem = os.totalmem() / 1048576; // convert to MB
    system.freemem = os.freemem() / 1048576; // convert to MB
    // os.cpus() // probably overkill to no the specifics of the cpus
    return {system:system};
}
    
Agent.prototype.post = function (data) {
    var data = _.extend(data, this.getSystemInfo());
    console.log(data);
	var headers = {
		"Accept":  "application/json",
		"Content-Type":  "application/json",
	}
    var ssl = false;
	var req = require('request');
	var options = {
		json:true,
		uri:"http://127.0.0.1/nii/public/htdocs/hosting/server/monitor",
		method: "POST",
		headers: headers,
		followRedirects:true,
		body:JSON.stringify(data),
		port: (ssl ? 443 : 80)
	};
	// send our request
    req(options, function(err, response, body){
		if (err) console.log(err);
	});
    
}

Agent.prototype.run = function (pollFreq) {
    this.pollFreq = pollFreq || 60000;
    // Do the checks
    this.doChecks();
    setInterval(_.bind(this.doChecks, this), this.pollFreq);
};

/**
 * Get apache stats
 */
Agent.prototype.getApacheStatus = function (callback) {

	this.log('getApacheStatus: start');
	
	var statusUrl = 'http://127.0.0.1/server-status/?auto';
	
	this.log('getApacheStatus: config set');
	this.log('getApacheStatus: attempting urlopen');
	
	var processAacheStatus = _.bind(function (response) {
		var str = '';
		if (response.statusCode !== 200) {
            this.error('Unable to get Apache status', 'getApacheStatus');
            callback(null, '');
        }
		
		response.on('error', _.bind(function (e) {
			this.error('Unable to get Apache status - HTTPError ' + e, 'getApacheStatus', e);
            callback(null, '');
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
                this.error('getApacheStatus: Total Accesses not present in mod_status output. Is ExtendedStatus enabled?', 'getApacheStatus');
            }
            
            if (apacheStatus['BusyWorkers'] !== undefined && apacheStatus['IdleWorkers'] !== undefined) {
                apacheStatusReturn['busyWorkers'] = apacheStatus['BusyWorkers'];
                apacheStatusReturn['idleWorkers'] = apacheStatus['idleWorkers'];
            } else {
                this.error('getApacheStatus: BusyWorkers/IdleWorkers not present in mod_status output. Is the URL correct (must have ?auto at the end)?', 'getApacheStatus');
            }
            
            // carefull these stats may be misleading as they are an average of across all requests and time
            // since the apache server was started
            if (apacheStatus['BytesPerReq'] !== undefined && apacheStatus['BytesPerSec'] !== undefined) {
                apacheStatusReturn['bytesPerReq'] = apacheStatus['BytesPerReq'];
                apacheStatusReturn['bytesPerSec'] = apacheStatus['BytesPerSec'];
            }
            
            if (_.isEmpty(apacheStatusReturn)) {
                this.log('No apache stats available');
            }
            
            callback(null, apacheStatusReturn);
            
		}, this));
	}, this);

	var req = http.request(statusUrl, processAacheStatus);
    req.on('error', _.bind(function (err){
        this.error('ApacheStatus: unable to connect to the Apache status url http://127.0.0.1/server-status?auto, has this been configured? And is the apache server running?', 'getApacheStatus', err);
        callback(null, '');
    }, this));
    req.end();
    this.log('getApacheStatus: function defined');
};

Agent.prototype.getDiskUsage = function (callback) {
	this.log('getDiskUsage: start');
	exec('df -k', _.bind(function (error, df, stderr) {
		if (error) this.error('getDiskUsage: Error running df command', 'getDiskUsage', error)
		this.log('getDiskUsage: Popen success, start parsing');

		// Split out each volume
		volumes = df.split(/\n/);
		
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
        
        // mac gives us extra data we don't want so we need to remove three additional positions
        // columns to remove: iused ifree %iused these are the 5,6 and 7 positions in the array
        if (process.platform == 'darwin') {
            _.each(usageData, function (volume, index) {
                   usageData[index].splice(5,3);
            });
        }
		
		this.log('getDiskUsage: completed, returning');
		usageData.push(['total', totalUsed, totalAvail]);
		
        callback(null, usageData);
        
	}, this));
	
};

Agent.prototype.getMySqlStatus = function(callback){
	this.log('getMySQLStatus: start');
    
    var mysqlStats = {};
    
    if (_.isUndefined(config.mysql.host) || _.isUndefined(config.mysql.user)) {
        this.error('getMySQLStatus: config not set', 'getMySQLStatus');
        callback(null, mysqlStats);
    }
    
    var db = mysql.createConnection(config.mysql); 
    db.connect();
    db.on('error', _.bind(function(err) {
        this.error('mysql connection error ' + err.code + ' ' + err, 'getMySQLStatus', err); 
        callback(null, mysqlStats); 
    }, this));
    
    // Get MySQL version
    if (this.mysqlVersion === undefined) {
        this.log('getMySQLStatus: mysqlVersion unset storing for first time');
        
        db.query('SELECT VERSION() as v', _.bind(function(err, rows, fields) {
            this.log('getMySQLStatus: db: select version');
            if (err) {this.error('mysql: select version ' + err, 'getMySQLStatus', err);return;}
            
            var version = rows[0]['v'];
            version = version.split('-');
            version = version[0].split('.')
            // may have to loop through each version number int in the array to ensure it is a number
            // but for now we'll stuff it in.
            mysqlStats.mysqlVersion = this.mysqlVersion = version;
            this.log('getMySQLStatus: db: select version -complete : ' + version);
        }, this));
    }
   
    // Connections per second
    db.query('SHOW STATUS LIKE "Connections"', _.bind(function(err, rows, fields) {
        this.log('getMySQLStatus: db: Connections');
        if (err) {this.error('mysql: Connections ' + err, 'getMySQLStatus', err);return;}
        
        if (this.mysqlConnectionsStore === undefined) {
            this.log('getMySQLStatus: mysqlConnectionsStore unset storing for first time');
            this.mysqlConnectionsStore = rows[0]['Value'];
            mysqlStats.connections = 0;
        } else {
            this.log('getMySQLStatus: mysqlConnectionsStore set so calculating');
            this.log('getMySQLStatus: self.mysqlConnectionsStore = ' + this.mysqlConnectionsStore);
            this.log('getMySQLStatus: result = ' + rows[1]);
            mysqlStats.connections = parseFloat(parseFloat(rows[0]['Value']) - parseFloat(this.mysqlConnectionsStore)) / this.pollFreq;
            this.mysqlConnectionsStore = rows[0]['Value'];
        }
			
    }, this));
        
    // Created_tmp_disk_tables
    // Determine query depending on version. For 5.02 and above we need the GLOBAL keyword
    if (this.mysqlVersion !== undefined) {
        var sql = '';
        if (this.mysqlVersion[0] >= 5 && this.mysqlVersion[2] >= 2) {
            sql = 'SHOW GLOBAL STATUS LIKE "Created_tmp_disk_tables"';
        } else {
            sql = 'SHOW STATUS LIKE "Created_tmp_disk_tables"';
        }
        db.query(sql, function (err, rows, fields) {
            if (err) {this.error('mysql: Created_tmp_disk_tables ' + err, 'getMySQLStatus', err);return;}
            mysqlStats.createdTmpDiskTables = parseFloat(rows[0]['Value']);
        });
    }
        
    // Max_used_connections
    db.query('SHOW STATUS LIKE "Max_used_connections"', _.bind(function (err, rows, fields) {
        if (err) {this.error('mysql: Max_used_connections ' + err, 'getMySQLStatus', err);return;}
        this.log('getMySQLStatus: getting Max_used_connections - done');
        mysqlStats.maxUsedConnections = parseFloat(rows[0]['Value']);
    }, this));
        
     // Open_files
    db.query('SHOW STATUS LIKE "Open_files"', _.bind(function (err, rows, fields) {
        if (err) {this.error('mysql: Open_files ' + err, 'getMySQLStatus');return;}
        this.log('getMySQLStatus: getting Open_files - done');
        mysqlStats.openFiles = parseFloat(rows[0]['Value']);
    }, this));
    
    // Slow_queries
    // Determine query depending on version. For 5.02 and above we need the GLOBAL keyword
    if (this.mysqlVersion !== undefined) {
        var sql = '';
        if (this.mysqlVersion[0] >= 5 && this.mysqlVersion[2] >= 2) {
            sql = 'SHOW GLOBAL STATUS LIKE "Slow_queries"';   
        } else {
            sql = 'SHOW STATUS LIKE "Slow_queries"'
        }
        db.query(sql, _.bind(function (err, rows, fields) {
            if (err) {this.error('mysql: Slow_queries ' + err, 'getMySQLStatus', err);return;}
            if (this.mysqlSlowQueriesStore === undefined) {
                this.mysqlSlowQueriesStore = rows[0]['Value'];
				mysqlStats.slowQueries = 0
            } else {
                this.log('getMySQLStatus: mysqlSlowQueriesStore set so calculating');
				this.log('getMySQLStatus: self.mysqlSlowQueriesStore = ' + this.mysqlSlowQueriesStore);
				this.log('getMySQLStatus: result = ' + rows[0]['Value']);

				mysqlStats.slowQueries = parseFloat(parseFloat(rows[0]['Value']) - parseFloat(this.mysqlSlowQueriesStore)) / this.pollFreq;
				this.mysqlSlowQueriesStore = rows[0]['Value'];
            }
        }, this));
    }
        
    // Table_locks_waited
    db.query('SHOW STATUS LIKE "Table_locks_waited"', _.bind(function (err, rows, fields) {
        if (err) {this.error('mysql: Table_locks_waited ' + err, 'getMySQLStatus', err);return;}
        mysqlStats.tableLocksWaited = parseFloat(rows[0]['Value']);
    }, this));
    
    // Threads_connected
    db.query('SHOW STATUS LIKE "Threads_connected"', _.bind(function (err, rows, fields) {
        if (err) {this.error('mysql: Threads_connected ' + err, 'getMySQLStatus', err);return;}
        mysqlStats.threadsConnected = rows[0]['Value'];
    }, this));

    // Seconds_Behind_Master
    if (config.mysql.slave !== undefined && config.mysql.slave) {
        db.query('SHOW SLAVE STATUS', _.bind(function (err, rows, fields) {
            if (err) {this.error('mysql: slave status ' + err, 'getMySQLStatus', err);return;}
            mysqlStats.secondsBehindMaster = 0;
            if(rows.length > 0){
                mysqlStats.secondsBehindMaster = rows[0]['Seconds_Behind_Master'];
            }
        }, this));
    }

    db.end(_.bind(function (err){
        if (err) {this.error('mysql: close connection ' + err, 'getMySQLStatus', err);}
        this.log('getMySQLStatus: complete');
        callback(null, mysqlStats);
    }, this));
    this.log('getMySQLStatus: function defined');
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


// get iostats
// for linux debian you need to install 
// apt-get install sysstat
Agent.prototype.getIoStats = function (callback) {
//	this.log('getIoStats: start');
    
    callback(null, null);
//    var ioStats = {};
    
//    if (process.platform === 'linux') {
//        exec('iostat -d 1 2 -x -k', function (err, stats, stderr){
//            // most likely error is that the command is not installed and does not exist;
//            if (err) {
//                this.error('Could not run "iostat" command. ' 
//                + 'Have you installed the sysstat package? try apt-get install sysstat, ' 
//                + 'and these stats may become available');
//                callback(null, null);
//            }
//            
////            headerRegexp = /([%\\/\-\_a-zA-Z0-9]+)[\s+]?/;
////            itemRegexp = /^([a-zA-Z0-9\/]+)/;
////            valueRegexp = /\d+\.\d+/;
//
//            var recentStats = stats.split('Device:')[2].split('\n')
//            var header = recentStats[0]
//            var headerNames = header.match(/([%\\/\-\_a-zA-Z0-9]+)[\s+]?/g);
//            var device = null;
//              
//            console.log(recentStats);
//                                                                   
//            callback(null, recentStats);
//            for (i = 0; i <= recentStats.length; i++) {
//                var row = recentStats[i];
//                
//            }
//            for statsIndex in range(1, len(recentStats)):
//                row = recentStats[statsIndex]
//
//                if not row:
//                    # Ignore blank lines.
//                    continue
//
//                deviceMatch = re.match(itemRegexp, row)
//
//                if deviceMatch is not None:
//                    # Sometimes device names span two lines.
//                    device = deviceMatch.groups()[0]
//
//                values = re.findall(valueRegexp, row.replace(',', '.'))
//
//                if not values:
//                    # Sometimes values are on the next line so we encounter
//                    # instances of [].
//                    continue
//
//                ioStats[device] = {}
//
//                for headerIndex in range(0, len(headerNames)):
//                    headerName = headerNames[headerIndex]
//                    ioStats[device][headerName] = values[headerIndex]
    
};

// get the load averagestats
Agent.prototype.getLoadAvrgs = function (callback) {
    this.log('getLoadAvrgs: start');
    
    var load = os.loadavg();
    var loadAvrgs = {'1':load[0],'5':load[1],'15':load[2]};
    callback(null, loadAvrgs);
    
};

Agent.prototype.getMemoryUsage = function (callback) {
	this.log('getMemoryUsage: start');
    
    if (process.platform === 'linux') {
        this.log('getMemoryUsage: linux');
        
        fs.readFile('/proc/meminfo', 'utf8', _.bind(function (err, data) {
            if (err) throw err;
            var meminfo = yaml.load();
            
            var memData = {};
			memData['physFree'] = 0;
			memData['physUsed'] = 0;
			memData['cached'] = 0;
			memData['swapFree'] = 0;
			memData['swapUsed'] = 0;
            
            // Phs
            this.log('getMemoryUsage: formatting (phys)');
            
            physTotal = parseInt(meminfo['MemTotal']);
            physFree = parseInt(meminfo['MemFree']);
            physUsed = physTotal - physFree;

            // Convert to MB
            memData['physFree'] = physFree / 1024;
            memData['physUsed'] = physUsed / 1024;
            memData['cached'] = parseInt(meminfo['Cached']) / 1024;
            
            this.log('getMemoryUsage: formatted (phys)');
            
            // Swap
            this.log('getMemoryUsage: formatting (swap)');

            var swapTotal = parseInt(meminfo['SwapTotal']);
            var swapFree = parseInt(meminfo['SwapFree']);
            var swapUsed = swapTotal - swapFree;

            // Convert to MB
            memData['swapFree'] = swapFree / 1024;
            memData['swapUsed'] = swapUsed / 1024;

            callback(null, memData);
            
        }, this));
    }
    
    else if (process.platform == 'darwin') {
        this.log('getMemoryUsage: darwin');
        exec('top -l 1', {timeout:500}, _.bind(function (error, top, stderr) {
            if (error) this.error('failed to run command: top -l 1', 'getMemoryUsage', error);
            this.log('getMemoryUsage:attempting exec (sysctl vm.swapusage)');
            exec('sysctl vm.swapusage', {timeout:500}, _.bind(function (error, sysctl, stderr) {
                if (error) this.error('failed to run command: sysctl vm.swapusage', 'getMemoryUsage', error);
                
                // Deal with top
                var lines = top.split(/\n/);
                var PhysMemIndex = 6; // this is 6 on mac 10.6 + and 5 on lower versions (ignoring lower versions for now)
                var physParts = lines[PhysMemIndex].match(/([0-9]\d+)/g);
                // Deal with sysctl
                var swapParts = sysctl.match(/([0-9]+\.\d+)/g);
                
                var mem = {'physUsed' : physParts[3], 'physFree' : physParts[4], 'swapUsed' : swapParts[1], 'swapFree' : swapParts[2], 'cached' : 'NULL'};
                
                callback(null, mem);
            }, this));
        }, this));
    }
};

Agent.prototype.getNetworkTraffic = function (callback) {
	this.log('getNetworkTraffic: start');
    callback(null, 'network stats');
};

// get processes stats
// runs ps auxww and parses the output into an array
// the array will contain the following items:
// USER, PID, %CPU, %MEM, VSZ, RSS, TT, STAT, STARTED, TIME, COMMAND
Agent.prototype.getProcesses = function (callback) {
	this.log('getProcesses: start');
    
    // Get output from ps
    exec('ps auxww', _.bind(function (err, ps, stderr){
        if (err) {
            this.error('Command "ps auxww" failed');
            callback(null, null);
        }
        // Split out each process
        var processLines = ps.split(/\n/);
        console.log(processLines);
        // remove top and bottom line
        processLines.splice(0,1);
        processLines.pop();
        var processes = [];
        
        this.log('getProcesses: Popen success, parsing, looping');
        
        _.each(processLines, function (line){
			line = line.split(/\s+/);
            // we only want 0 - 10 columns, everything with a white space after this must belong to the last column
            // remove the additional columns and place them in extra
			var extra = line.splice(11, line.length);

            line[10] = line[10] + ' ' + extra.join(' ');
            
            processes.push(line);
            
        });
        
        callback(null, processes);
        
    }, this));
};

Agent.prototype.log = function (msg) {
    // console.log(msg);
};

Agent.prototype.error = function (msg, category, error) {
    
    this.errors.push({
        msg:msg, category:category, error:error
    })
        
	// console.log(msg);
};


module.exports = new Agent();