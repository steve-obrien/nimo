var exec = require('child_process').exec
  , _ = require('underscore')
  , http = require('http')
  , async = require('async') 
  , config = require('../config/config')
  , mysql = require('mysql')
  , fs = require('fs')
  , request = require('request')
  , yaml = require('js-yaml') // lots of output is in this format (or can be parsed by it)
  , os = require('os'); // convinient core node module to get os & platform data

/**
 * Agent is a silent process on a server that monitors various server metrics.
 */
function Agent() {}

/**
 * Run function
 * This function:
 * - creates a new timer on an interval, (pollFreq) 
 * - runs the Logging functions every interval and aggregates into a single payload object
 * - posts the payload to the monitoring server
 * @pollFreq integer number of milliseconds for the logging frequency, defaults to 60000 (60 seconds)
 */
Agent.prototype.run = function (pollFreq) {
    this.pollFreq = pollFreq || (config.pollFreq * 1000) || 60000;
    this.networkTrafficStore = {};
	// Do the checks
    this.runChecks();
    setInterval(_.bind(this.runChecks, this), this.pollFreq);
};

/**
 * Checks
 * Run all check functions and collect the data into an object and post it
 * Stat: stats data
 */
Agent.prototype.runChecks = function () {
    // store an object of errors encoutered on this journey.
    this.errors = [];

    async.parallel({
		system     : _.bind(this.getSystemInfo, this),
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
        this.log('----------------------------------------');
        this.log('Finished Logging Functions');
		// post the results
		results.device = config.device || results.system.hostname
        this.post(results);
        
    }, this));
}

/**
 * Post the payload to the monitoring server
 * @data json object of the payload logging data
 */
Agent.prototype.post = function (data) {
	
	this.log('Payload:');
	this.log(data);
	
	var headers = {
		"Accept":  "application/json",
		"Content-Type":  "application/json",
	}
    var ssl = false;
	var req = require('request');
	var options = {
		json: true,
		uri: config.url,
		method: "POST",
		headers: headers,
		followRedirects: true,
		body: JSON.stringify(data),
		port: (ssl ? 443 : 80)
	};
	// send our request
    req(options, function(err, response, body){
		if (err) console.log(err);
	});
}

/**
 * Logger Function: System Info
 * Get some basic system info to add to the payload
 */
Agent.prototype.getSystemInfo = function (callback) {
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
    callback(null, system);
}

/**
 * Logger Function: Apache Status
 */
Agent.prototype.getApacheStatus = function (callback) {

	this.log('getApacheStatus: start');
	
	var statusUrl = config.apache.statusUrl;
	
	this.log('getApacheStatus: config set');
	this.log('getApacheStatus: attempting urlopen');
	
	var processAacheStatus = _.bind(function (response) {
		var str = '';
		if (response.statusCode !== 200) {
            this.error('Unable to get Apache status', 'getApacheStatus');
            callback(null, {});
        }
		
		response.on('error', _.bind(function (e) {
			this.error('Unable to get Apache status - HTTPError ' + e, 'getApacheStatus', e);
            callback(null, {});
		}, this));
		
		response.on('data', function (chunk) {
			str += chunk;
		});

		//the whole response has been recieved
		response.on('end', _.bind(function () {
			
			var apacheStatus = yaml.load(str);

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
                apacheStatusReturn['idleWorkers'] = apacheStatus['IdleWorkers'];
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
        callback(null, {});
    }, this));
    req.end();
    this.log('getApacheStatus: function defined');
};

/**
 * Logger Function: Disck Usage
 */
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

/**
 * Logger Function: Mysql Stats
 */
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

/**
 * Logger Function: CPU Stats
 * for linux debian you need to install sysstat
 * apt-get install sysstat
 */
Agent.prototype.getCpuStats = function (callback) {
	
	this.log('getCPUStats: start')
	
	if (process.platform == 'linux') {
		
		var cpuStats = {};
		var proc = null;
		
		exec('mpstat -P ALL 1 1', _.bind(function (err, stats) {
			
			if (err) {
				this.error('Error whilst executing command "mpstat -P ALL 1 1" you may have to install sysstat: apt-get install sysstat ', 'getCpuStats', err);
				callback(null, {});
			}
			
			stats = stats.split(/\n/);
			var header = stats[2];
			var headerNames = header.match(/([%][a-zA-Z0-9]+)[\s+]?/g);
			console.log(headerNames);
			var device = null;
			console.log(headerNames);
			// skip index 3 "all"
			for (i=4; i <= stats.length; i++) {
				var row = stats[i];
				
				if (!row)
					break;

				deviceMatch = row.match(/.*?\s+(\d+)[\s+]?/);
				
				if (deviceMatch != null)
					device = 'CPU' + deviceMatch[1];
				//console.log(row);
				var values = row.replace(',', '.').match(/\d+\.\d+/g);

				cpuStats[device] = {};
				//console.log('values');
				//console.log(values);
				for (hi=0; hi <= headerNames.length-1; hi++) {
					headerName = headerNames[hi];
					cpuStats[device][headerName.replace('%','')] = values[hi];
				}					
			}
			console.log(cpuStats);
			callback(null, cpuStats);

		}, this));
		
	} else {
		this.log('getCPUStats: unsupported platform');
		callback(null, {});
	}

};

/**
 * Logger Function: IO Stats
 * for linux debian you need to install sysstat
 * apt-get install sysstat
 */
Agent.prototype.getIoStats = function (callback) {
	
	this.log('getIOStats: start');

	if (process.platform == 'linux') {
		var ioStats = {} 
		
		exec('iostat -d 1 2 -x -k', _.bind(function (err, stats) {
			if (err) {
				this.error('Error executing command "iostat -d 1 2 -x -k" the command may not exist have you installed systat? Try: pt-get install sysstat', 'getIoStats', err)
				callback(null, {});
			}
			var headerRegexp = /([%\\/\-\_a-zA-Z0-9]+)[\s+]?/g;
			var itemRegexp = /^([a-zA-Z0-9\/]+)/;
			var valueRegexp = /\d+\.\d+/g;

			var recentStats = stats.split('Device:')[2].split(/\n/);
			var header = recentStats[0];
			var headerNames = header.match(headerRegexp);
			var device = null;

			for (i=1; i <= recentStats.length; i++) {
				var row = recentStats[i];

				// ignor blank lines
				if (!row)
					continue;

				var deviceMatch = row.match(itemRegexp);

				if (deviceMatch !== null) {
					// Sometimes device names span two lines.
					device = deviceMatch[0];
				}

				var values = row.replace(',', '.').match(valueRegexp);

				if (!values) {
					// Sometimes values are on the next line so we encounter
					// instances of [].
					continue;
				}

				ioStats[device] = {};
				
				for (hi=0; hi <= headerNames.length-1; hi++) {
					ioStats[device][headerNames[hi]] = values[hi];
				}

			}
			
			callback(null, ioStats);
		},this));
		
	} else {
		this.log('getIOStats: unsupported platform');
		callback(null, {});
	}
    
};

/**
 * Logger Function: Load Averages
 */
Agent.prototype.getLoadAvrgs = function (callback) {
    this.log('getLoadAvrgs: start');
    var load = os.loadavg();
    var loadAvrgs = {'1':load[0],'5':load[1],'15':load[2]};
    callback(null, loadAvrgs);
};

/**
 * Logger Function: Memory Useage
 */
Agent.prototype.getMemoryUsage = function (callback) {
	this.log('getMemoryUsage: start');
    
    if (process.platform === 'linux') {
        this.log('getMemoryUsage: linux');
        
        fs.readFile('/proc/meminfo', 'utf8', _.bind(function (err, data) {
            if (err) throw err;
			// load in data as yaml... convinient
            var meminfo = yaml.load(data);
            var memData = {physFree:0, physUsed:0, cached:0, swapFree:0, swapUsed:0};
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

/**
 * Logger Function: Network Traffic
 */
Agent.prototype.getNetworkTraffic = function (callback) {

    if (process.platform == 'linux') {
		
        fs.readFile('/proc/net/dev', 'utf8', _.bind(function (err, data) {
            if (err) {
                this.error('Error whilst opening /proc/net/dev for reading', 'getNetworkTraffic', err);
                callback(null, {});
            }
            
            var lines = data.split(/\n/);
            var columnLine = lines[1];
            
            var cols = columnLine.split('|');
            var __ = cols[0];
            var receiveCols = cols[1] ;
            var transmitCols = cols[2];
            
            var r = _.map(receiveCols.split(/\s+/), function (item){return 'recv_' + item;});
			var t = _.map(transmitCols.split(/\s+/), function (item){return 'trans_' + item;});
            var cols = r.concat(t);
			
			var faces = {};
			// for each line of data split the data and map to cols. col:data
            _.each(lines, function (line, key){
                if (key == 0 || key == 1) return;
                if (line.indexOf(':') < 0) return;
                var split = line.split(':');
                var face = split[0];
                var data = split[1].split(/\s+/);
				
				faces[face] = _.object(cols, data);
				
            });
			
			var interfaces = {}
			
			// Now loop through each interface 
			// We need to work out the traffic since the last check so first time we store the current value
			// then the next time we can calculate the difference
			_.each(faces, function (f, face){

				var key = face.replace(/\s+/g, '');
				
				if (this.networkTrafficStore[key] !== undefined) {

					interfaces[key] = {}
					interfaces[key]['recv_bytes'] = parseInt(faces[face]['recv_bytes']) - parseInt(this.networkTrafficStore[key]['recv_bytes']);
					interfaces[key]['trans_bytes'] = parseInt(faces[face]['trans_bytes']) - parseInt(this.networkTrafficStore[key]['trans_bytes']);

					if (interfaces[key]['recv_bytes'] < 0)
						interfaces[key]['recv_bytes'] = faces[face]['recv_bytes'];

					if (interfaces[key]['trans_bytes'] < 0)
						interfaces[key]['trans_bytes'] = faces[face]['trans_bytes'];

					// And update the stored value to subtract next time round
					this.networkTrafficStore[key]['recv_bytes'] = faces[face]['recv_bytes']
					this.networkTrafficStore[key]['trans_bytes'] = faces[face]['trans_bytes']
					
				} else {
					this.networkTrafficStore[key] = {}
					this.networkTrafficStore[key]['recv_bytes'] = faces[face]['recv_bytes'];
					this.networkTrafficStore[key]['trans_bytes'] = faces[face]['trans_bytes'];
				}
				
									
			}, this);
			
			callback(null, interfaces);
            
        }, this))
	}
	
	else {
		
		exec('netstat -nbid', _.bind(function (err, netstat){
			
			if (err) {
				this.error('Error executing command netstat -nbid', 'getNetworkTraffic', err);
				callback(null, {});
			}
			
			var lines = netstat.split(/\n/);
			
			// Loop over available data for each inteface
			var faces = {};
			var rxKey = null;
			var txKey = null;
			
			_.each(lines, function (line){
				
				 // split each line into columns, based on the whitespace. 
				 // To make things fun sometimes a column will not have any values and be filled with spaces, 
				 // thus screwing up the index position.
				 // To correct this we only split by whitespace 20 characters or under, 
				 // if whitespace is more than 20 characters we assume its a column with an empty value
				var line = line.split(/\s{1,20}/);
				
				// Figure out which index we need
				if (rxKey == null && txKey == null) {
					
					_.each(line, function (part, k){
						
						if (part == 'Ibytes')
							rxKey = k; 
						else if (part == 'Obytes')
							txKey = k;
						
					}, this);
					
				} else {
					if (faces[line[0]] === undefined) {
						if (line[0] != '') {
							this.log('getNetworkTraffic: parsing (rx: '+rxKey+' = '+line[rxKey]+' / tx: '+txKey+' = '+line[txKey]+')');
							faces[line[0]] = {'recv_bytes': line[rxKey], 'trans_bytes': line[txKey]};
						}
					}
				}
     
			}, this);
			
			var interfaces = {}

			// Now loop through each interface
			_.each(faces, function (f, face) {
				
				var key = face.replace(/\s+/g, '');
				
				// We need to work out the traffic since the last check so first time we store the current value
				// then the next time we can calculate the difference
				if (this.networkTrafficStore[key] !== undefined) {
					
					interfaces[key] = {}
					interfaces[key]['recv_bytes'] = parseInt(faces[face]['recv_bytes']) - parseInt(this.networkTrafficStore[key]['recv_bytes']);
					interfaces[key]['trans_bytes'] = parseInt(faces[face]['trans_bytes']) - parseInt(this.networkTrafficStore[key]['trans_bytes']);

					interfaces[key]['recv_bytes'] = interfaces[key]['recv_bytes'];
					interfaces[key]['trans_bytes'] = interfaces[key]['trans_bytes'];

					if (interfaces[key]['recv_bytes'] < 0)
						interfaces[key]['recv_bytes'] = parseInt(faces[face]['recv_bytes']);

					if (interfaces[key]['trans_bytes'] < 0)
						interfaces[key]['trans_bytes'] = parseInt(faces[face]['trans_bytes']);

					// And update the stored value to subtract next time round
					this.networkTrafficStore[key]['recv_bytes'] = faces[face]['recv_bytes'];
					this.networkTrafficStore[key]['trans_bytes'] = faces[face]['trans_bytes'];
					
				} else {
					this.networkTrafficStore[key] = {};
					this.networkTrafficStore[key]['recv_bytes'] = faces[face]['recv_bytes'];
					this.networkTrafficStore[key]['trans_bytes'] = faces[face]['trans_bytes'];
				}
			}, this);
			
			callback(null, interfaces);
			
		}, this));
		
	}
    
};

/**
 * Logger Function: Processes
 * get processes stats
 * runs ps auxww and parses the output into an array
 * the array will contain the following items:
 * USER, PID, %CPU, %MEM, VSZ, RSS, TT, STAT, STARTED, TIME, COMMAND
 */
Agent.prototype.getProcesses = function (callback) {
	this.log('getProcesses: start');
    
    // Get output from ps
    exec('ps auxww', _.bind(function (err, ps, stderr){
        if (err) {
            this.error('Command "ps auxww" failed');
            callback(null, {});
        }
        // Split out each process
        var processLines = ps.split(/\n/);
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

/**
 * Logger Function: Mongo Db stats
 */
Agent.prototype.getMongoDbStatus = function(callback) {
	
	// TODO ...
//	this.log('getMongoDBStatus: start');
//	
//	if (config.mongodb === undefined || config.mongodb.server === undefined || config.mongodb.server == '') {
//		this.log('getMongoDBStatus: config not set');
//		callback(null, {});
//	}
//	
//	var mongodb = {};
	
}

/**
 * System Log Function. Outputs debug info
 * Only used when Config.logging = 'debug'
 */
Agent.prototype.log = function (msg) {
	if (config.logging == 'debug') {
		console.log(msg);
	}
};

/**
 * Error logging function. Stores errors in an array for output.
 */
Agent.prototype.error = function (msg, category, error) {
    this.errors.push({
        msg:msg, category:category, error:error
    });
	console.log(error + ' ' + msg);
};

module.exports = new Agent();