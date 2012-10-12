var exec = require('child_process').exec;
var _ = require('underscore');
var http = require('http');


/**
 * Agent is a silent process on a server that monitors various server metrics.
 */
function Agent() {
	console.log('oi');
}

Agent.prototype.run = function () {
	// Do the checks
	var apacheStatus = this.getApacheStatus(),
		diskUsage = this.getDiskUsage(),
		loadAvrgs = this.getLoadAvrgs(),
		memory = this.getMemoryUsage(),
		mysqlStatus = this.getMySqlStatus(),
		networkTraffic = this.getNetworkTraffic(),
		processes = this.getProcesses(),
		ioStats = this.getIoStats(),
		cpuStats = this.getCpuStats();
		
	
};

Agent.prototype.getApacheStatus = function () {
	this.log('getApacheStatus: start');
	
	var statusUrl = 'http://127.0.0.1/server-status/?auto';
	
	this.log('getApacheStatus: config set');
	this.log('getApacheStatus: attempting urlopen');
	
	var processAacheStatus = _.bind(function (response) {
		var str = '';
		if (response.statusCode !== 200) {
            this.error('Unable to get Apache status');
        }
		
		response.on('error', _.bind(function (e) {
			this.error('Unable to get Apache status - HTTPError ' + e.message);
		}, this));
		
		response.on('data', function (chunk) {
			str += chunk;
		});

		//the whole response has been recieved
		response.on('end', _.bind(function () {
			console.log(str);
			// split out each line
			var lines = str.split('\n'),
                apacheStatus = {};
			
			this.log('getApacheStatus: parsing, loop');
			
			for (i = 0; i < lines.length; i++) {
				var values = lines[i].split(': ');
				if (values.length == 2)
				    apacheStatus[values[0]] = values[1];
			}
			this.log(apacheStatus);
			this.log('getApacheStatus: parsed');
				
		}, this));
	}, this);

	http.request(statusUrl, processAacheStatus).end();

//			# Loop over each line and get the values
//
//			self.mainLogger.debug('getApacheStatus: parsing, loop')
//
//			# Loop through and extract the numerical values
//			for line in lines:
//				values = line.split(': ')
//
//				try:
//					apacheStatus[str(values[0])] = values[1]
//
//				except IndexError:
//					break
//
//			self.mainLogger.debug('getApacheStatus: parsed')
//
//			apacheStatusReturn = {}
//
//			try:
//
//				if apacheStatus['Total Accesses'] != False:
//
//					self.mainLogger.debug('getApacheStatus: processing total accesses')
//
//					totalAccesses = float(apacheStatus['Total Accesses'])
//
//					if self.apacheTotalAccesses is None or self.apacheTotalAccesses <= 0 or totalAccesses <= 0:
//
//						apacheStatusReturn['reqPerSec'] = 0.0
//
//						self.apacheTotalAccesses = totalAccesses
//
//						self.mainLogger.debug('getApacheStatus: no cached total accesses (or totalAccesses == 0), so storing for first time / resetting stored value')
//
//					else:
//
//						self.mainLogger.debug('getApacheStatus: cached data exists, so calculating per sec metrics')
//
//						apacheStatusReturn['reqPerSec'] = (totalAccesses - self.apacheTotalAccesses) / 60
//
//						self.apacheTotalAccesses = totalAccesses
//
//				else:
//
//					self.mainLogger.error('getApacheStatus: Total Accesses not present in mod_status output. Is ExtendedStatus enabled?')
//
//			except IndexError:
//				self.mainLogger.error('getApacheStatus: IndexError - Total Accesses not present in mod_status output. Is ExtendedStatus enabled?')
//
//			except KeyError:
//				self.mainLogger.error('getApacheStatus: KeyError - Total Accesses not present in mod_status output. Is ExtendedStatus enabled?')
//
//			try:
//
//				if apacheStatus['BusyWorkers'] != False and apacheStatus['IdleWorkers'] != False:
//
//					apacheStatusReturn['busyWorkers'] = apacheStatus['BusyWorkers']
//					apacheStatusReturn['idleWorkers'] = apacheStatus['IdleWorkers']
//
//				else:
//
//					self.mainLogger.error('getApacheStatus: BusyWorkers/IdleWorkers not present in mod_status output. Is the URL correct (must have ?auto at the end)?')
//
//			except IndexError:
//				self.mainLogger.error('getApacheStatus: IndexError - BusyWorkers/IdleWorkers not present in mod_status output. Is the URL correct (must have ?auto at the end)?')
//
//			except KeyError:
//				self.mainLogger.error('getApacheStatus: KeyError - BusyWorkers/IdleWorkers not present in mod_status output. Is the URL correct (must have ?auto at the end)?')
//
//			if 'reqPerSec' in apacheStatusReturn or 'BusyWorkers' in apacheStatusReturn or 'IdleWorkers' in apacheStatusReturn:
//
//				return apacheStatusReturn
//
//			else:
//
//				return False
//
//		else:
//			self.mainLogger.debug('getApacheStatus: config not set')
//
//			return False
};

Agent.prototype.getDiskUsage = function (msg) {
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
		
	}, this));
	
};

Agent.prototype.getCpuStats = function (msg) {
	this.log('getCpuStats: start');
};

Agent.prototype.getIoStats = function (msg) {
	this.log('getIoStats: start');
};

Agent.prototype.getLoadAvrgs = function (msg) {
	this.log('getLoadAvrgs: start');
};

Agent.prototype.getMemoryUsage = function (msg) {
	this.log('getMemoryUsage: start');
};

Agent.prototype.getMySqlStatus = function(msg){
	this.log('getMySQLStatus: start');
};

Agent.prototype.getNetworkTraffic = function (msg) {
	this.log('getNetworkTraffic: start');
};



Agent.prototype.getProcesses = function (msg) {
	this.log('getProcesses: start');
};

Agent.prototype.log = function (msg) {
	console.log(msg);
};

Agent.prototype.error = function (msg) {
	console.log(msg);
};




module.exports = new Agent();
