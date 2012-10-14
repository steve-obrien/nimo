'''
	Server Density
	www.serverdensity.com
	----
	Server monitoring agent for Linux, FreeBSD and Mac OS X

	Licensed under Simplified BSD License (see LICENSE)
'''

# SO references
# http://stackoverflow.com/questions/446209/possible-values-from-sys-platform/446210#446210
# http://stackoverflow.com/questions/682446/splitting-out-the-output-of-ps-using-python/682464#682464
# http://stackoverflow.com/questions/1052589/how-can-i-parse-the-output-of-proc-net-dev-into-keyvalue-pairs-per-interface-us



# We need to return the data using JSON. As of Python 2.6+, there is a core JSON
# module. We have a 2.4/2.5 compatible lib included with the agent but if we're
# on 2.6 or above, we should use the core module which will be faster
pythonVersion = platform.python_version_tuple()
python24 = platform.python_version().startswith('2.4')

# Build the request headers
headers = {
	'User-Agent': 'Server Density Agent',
	'Content-Type': 'application/x-www-form-urlencoded',
	'Accept': 'text/html, */*',
}

if int(pythonVersion[1]) >= 6: # Don't bother checking major version since we only support v2 anyway
	import json
else:
	import minjson

class checks:

	def __init__(self, agentConfig, rawConfig, mainLogger):
		self.agentConfig = agentConfig
		self.rawConfig = rawConfig
		self.mainLogger = mainLogger

		self.mysqlConnectionsStore = None
		self.mysqlSlowQueriesStore = None
		self.mysqlVersion = None
		self.networkTrafficStore = {}
		self.nginxRequestsStore = None
		self.mongoDBStore = None
		self.apacheTotalAccesses = None
		self.plugins = None
		self.topIndex = 0
		self.os = None
		self.linuxProcFsLocation = None

		# Set global timeout to 15 seconds for all sockets (case 31033). Should be long enough
		import socket
		socket.setdefaulttimeout(15)

	#
	# Checks
	#

	
	def getCPUStats(self):
		self.mainLogger.debug('getCPUStats: start')

		cpuStats = {}

		if sys.platform == 'linux2':
			self.mainLogger.debug('getCPUStats: linux2')

			headerRegexp = re.compile(r'.*?([%][a-zA-Z0-9]+)[\s+]?')
			itemRegexp = re.compile(r'.*?\s+(\d+)[\s+]?')
			valueRegexp = re.compile(r'\d+\.\d+')
			proc = None
			try:
				proc = subprocess.Popen(['mpstat', '-P', 'ALL', '1', '1'], stdout=subprocess.PIPE, close_fds=True)
				stats = proc.communicate()[0]

				if int(pythonVersion[1]) >= 6:
					try:
						proc.kill()
					except Exception, e:
						self.mainLogger.debug('Process already terminated')

				stats = stats.split('\n')
				header = stats[2]
				headerNames = re.findall(headerRegexp, header)
				device = None

				for statsIndex in range(4, len(stats)): # skip "all"
					row = stats[statsIndex]

					if not row: # skip the averages
						break

					deviceMatch = re.match(itemRegexp, row)

					if deviceMatch is not None:
						device = 'CPU%s' % deviceMatch.groups()[0]

					values = re.findall(valueRegexp, row.replace(',', '.'))

					cpuStats[device] = {}
					for headerIndex in range(0, len(headerNames)):
						headerName = headerNames[headerIndex]
						cpuStats[device][headerName] = values[headerIndex]

			except OSError, ex:
				# we dont have it installed return nothing
				return False

			except Exception, ex:
				if int(pythonVersion[1]) >= 6:
					try:
						if proc:
							proc.kill()
					except UnboundLocalError, e:
						self.mainLogger.debug('Process already terminated')
					except Exception, e:
						self.mainLogger.debug('Process already terminated')

				import traceback
				self.mainLogger.error('getCPUStats: exception = %s', traceback.format_exc())
				return False
		else:
			self.mainLogger.debug('getCPUStats: unsupported platform')
			return False

		self.mainLogger.debug('getCPUStats: completed, returning')
		return cpuStats

	def getDiskUsage(self):
		self.mainLogger.debug('getDiskUsage: start')

		# Get output from df
		try:
			try:
				self.mainLogger.debug('getDiskUsage: attempting Popen')

				proc = subprocess.Popen(['df', '-k'], stdout=subprocess.PIPE, close_fds=True) # -k option uses 1024 byte blocks so we can calculate into MB
				
				df = proc.communicate()[0]

				if int(pythonVersion[1]) >= 6:
					try:
						proc.kill()
					except Exception, e:
						self.mainLogger.debug('Process already terminated')

			except Exception, e:
				import traceback
				self.mainLogger.error('getDiskUsage: df -k exception = %s', traceback.format_exc())
				return False

		finally:
			if int(pythonVersion[1]) >= 6:
				try:
					proc.kill()
				except Exception, e:
					self.mainLogger.debug('Process already terminated')

		self.mainLogger.debug('getDiskUsage: Popen success, start parsing')

		# Split out each volume
		volumes = df.split('\n')

		self.mainLogger.debug('getDiskUsage: parsing, split')

		# Remove first (headings) and last (blank)
		volumes.pop(0)
		volumes.pop()

		self.mainLogger.debug('getDiskUsage: parsing, pop')

		usageData = []

		regexp = re.compile(r'([0-9]+)')

		# Set some defaults
		previousVolume = None
		volumeCount = 0

		self.mainLogger.debug('getDiskUsage: parsing, start loop')

		for volume in volumes:
			self.mainLogger.debug('getDiskUsage: parsing volume: %s', volume)

			# Split out the string
			volume = volume.split(None, 10)

			# Handle df output wrapping onto multiple lines (case 27078 and case 30997)
			# Thanks to http://github.com/sneeu
			if len(volume) == 1: # If the length is 1 then this just has the mount name
				previousVolume = volume[0] # We store it, then continue the for
				continue

			if previousVolume != None: # If the previousVolume was set (above) during the last loop
				volume.insert(0, previousVolume) # then we need to insert it into the volume
				previousVolume = None # then reset so we don't use it again

			volumeCount = volumeCount + 1

			# Sometimes the first column will have a space, which is usually a system line that isn't relevant
			# e.g. map -hosts              0         0          0   100%    /net
			# so we just get rid of it
			# Also ignores lines with no values (AGENT-189)
			if re.match(regexp, volume[1]) == None or re.match(regexp, volume[2]) == None or re.match(regexp, volume[3]) == None:

				pass

			else:
				try:
					volume[2] = int(volume[2]) / 1024 / 1024 # Used
					volume[3] = int(volume[3]) / 1024 / 1024 # Available
				except Exception, e:
					self.mainLogger.error('getDiskUsage: parsing, loop %s - Used or Available not present' % (repr(e),))

				usageData.append(volume)

		self.mainLogger.debug('getDiskUsage: completed, returning')

		return usageData

	def getIOStats(self):
		self.mainLogger.debug('getIOStats: start')

		ioStats = {}

		if sys.platform == 'linux2':
			self.mainLogger.debug('getIOStats: linux2')

			headerRegexp = re.compile(r'([%\\/\-\_a-zA-Z0-9]+)[\s+]?')
			itemRegexp = re.compile(r'^([a-zA-Z0-9\/]+)')
			valueRegexp = re.compile(r'\d+\.\d+')

			try:
				try:
					proc = subprocess.Popen(['iostat', '-d', '1', '2', '-x', '-k'], stdout=subprocess.PIPE, close_fds=True)

					stats = proc.communicate()[0]
					if int(pythonVersion[1]) >= 6:
						try:
							proc.kill()
						except Exception, e:
							self.mainLogger.debug('Process already terminated')

					recentStats = stats.split('Device:')[2].split('\n')
					header = recentStats[0]
					headerNames = re.findall(headerRegexp, header)
					device = None

					for statsIndex in range(1, len(recentStats)):
						row = recentStats[statsIndex]

						if not row:
							# Ignore blank lines.
							continue

						deviceMatch = re.match(itemRegexp, row)

						if deviceMatch is not None:
							# Sometimes device names span two lines.
							device = deviceMatch.groups()[0]

						values = re.findall(valueRegexp, row.replace(',', '.'))

						if not values:
							# Sometimes values are on the next line so we encounter
							# instances of [].
							continue

						ioStats[device] = {}

						for headerIndex in range(0, len(headerNames)):
							headerName = headerNames[headerIndex]
							ioStats[device][headerName] = values[headerIndex]

				except OSError, ex:
					# we don't have iostats installed just return false
					return False

				except Exception, ex:
					import traceback
					self.mainLogger.error('getIOStats: exception = %s', traceback.format_exc())
					return False
			finally:
				if int(pythonVersion[1]) >= 6:
					try:
						proc.kill()
					except Exception, e:
						self.mainLogger.debug('Process already terminated')

		else:
			self.mainLogger.debug('getIOStats: unsupported platform')
			return False

		self.mainLogger.debug('getIOStats: completed, returning')
		return ioStats

	def getLoadAvrgs(self):
		self.mainLogger.debug('getLoadAvrgs: start')

		# If Linux like procfs system is present and mounted we use loadavg, else we use uptime
		if sys.platform == 'linux2':

			self.mainLogger.debug('getLoadAvrgs: linux2')

			try:
				self.mainLogger.debug('getLoadAvrgs: attempting open')

				if sys.platform == 'linux2':
					loadAvrgProc = open('/proc/loadavg', 'r')
				else:
					loadAvrgProc = open(self.linuxProcFsLocation + '/loadavg', 'r')

				uptime = loadAvrgProc.readlines()

			except IOError, e:
				self.mainLogger.error('getLoadAvrgs: exceptio = %s', e)
				return False

			self.mainLogger.debug('getLoadAvrgs: open success')

			loadAvrgProc.close()

			uptime = uptime[0] # readlines() provides a list but we want a string

		elif sys.platform.find('freebsd') != -1:
			self.mainLogger.debug('getLoadAvrgs: freebsd (uptime)')

			try:
				try:
					self.mainLogger.debug('getLoadAvrgs: attempting Popen')

					proc = subprocess.Popen(['uptime'], stdout=subprocess.PIPE, close_fds=True)
					uptime = proc.communicate()[0]

					if int(pythonVersion[1]) >= 6:
						try:
							proc.kill()
						except Exception, e:
							self.mainLogger.debug('Process already terminated')

				except Exception, e:
					import traceback
					self.mainLogger.error('getLoadAvrgs: exception = %s', traceback.format_exc())
					return False
			finally:
				if int(pythonVersion[1]) >= 6:
					try:
						proc.kill()
					except Exception, e:
						self.mainLogger.debug('Process already terminated')

			self.mainLogger.debug('getLoadAvrgs: Popen success')

		elif sys.platform == 'darwin':
			self.mainLogger.debug('getLoadAvrgs: darwin')

			# Get output from uptime
			try:
				try:
					self.mainLogger.debug('getLoadAvrgs: attempting Popen')

					proc = subprocess.Popen(['uptime'], stdout=subprocess.PIPE, close_fds=True)
					uptime = proc.communicate()[0]

					if int(pythonVersion[1]) >= 6:
						try:
							proc.kill()
						except Exception, e:
							self.mainLogger.debug('Process already terminated')

				except Exception, e:
					import traceback
					self.mainLogger.error('getLoadAvrgs: exception = %s', traceback.format_exc())
					return False
			finally:
				if int(pythonVersion[1]) >= 6:
					try:
						proc.kill()
					except Exception, e:
						self.mainLogger.debug('Process already terminated')

			self.mainLogger.debug('getLoadAvrgs: Popen success')

		elif sys.platform.find('sunos') != -1:
			self.mainLogger.debug('getLoadAvrgs: solaris (uptime)')

			try:
				try:
					self.mainLogger.debug('getLoadAvrgs: attempting Popen')

					proc = subprocess.Popen(['uptime'], stdout=subprocess.PIPE, close_fds=True)
					uptime = proc.communicate()[0]

					if int(pythonVersion[1]) >= 6:
						try:
							proc.kill()
						except Exception, e:
							self.mainLogger.debug('Process already terminated')

				except Exception, e:
					import traceback
					self.mainLogger.error('getLoadAvrgs: exception = %s', traceback.format_exc())
					return False
			finally:
				if int(pythonVersion[1]) >= 6:
					try:
						proc.kill()
					except Exception, e:
						self.mainLogger.debug('Process already terminated')

			self.mainLogger.debug('getLoadAvrgs: Popen success')

		else:
			self.mainLogger.debug('getLoadAvrgs: other platform, returning')
			return False

		self.mainLogger.debug('getLoadAvrgs: parsing')

		# Split out the 3 load average values
		loadAvrgs = [res.replace(',', '.') for res in re.findall(r'([0-9]+[\.,]\d+)', uptime)]
		loadAvrgs = {'1': loadAvrgs[0], '5': loadAvrgs[1], '15': loadAvrgs[2]}

		self.mainLogger.debug('getLoadAvrgs: completed, returning')

		return loadAvrgs

	def getMemoryUsage(self):
		self.mainLogger.debug('getMemoryUsage: start')

		# If Linux like procfs system is present and mounted we use meminfo, else we use "native" mode (vmstat and swapinfo)
		if sys.platform == 'linux2':

			self.mainLogger.debug('getMemoryUsage: linux2')

			try:
				self.mainLogger.debug('getMemoryUsage: attempting open')

				if sys.platform == 'linux2':
					meminfoProc = open('/proc/meminfo', 'r')
				else:
					meminfoProc = open(self.linuxProcFsLocation + '/meminfo', 'r')

				lines = meminfoProc.readlines()

			except IOError, e:
				self.mainLogger.error('getMemoryUsage: exception = %s', e)
				return False

			self.mainLogger.debug('getMemoryUsage: Popen success, parsing')

			meminfoProc.close()

			self.mainLogger.debug('getMemoryUsage: open success, parsing')

			regexp = re.compile(r'([0-9]+)') # We run this several times so one-time compile now

			meminfo = {}

			self.mainLogger.debug('getMemoryUsage: parsing, looping')

			# Loop through and extract the numerical values
			for line in lines:
				values = line.split(':')

				try:
					# Picks out the key (values[0]) and makes a list with the value as the meminfo value (values[1])
					# We are only interested in the KB data so regexp that out
					match = re.search(regexp, values[1])

					if match != None:
						meminfo[str(values[0])] = match.group(0)

				except IndexError:
					break

			self.mainLogger.debug('getMemoryUsage: parsing, looped')

			memData = {}
			memData['physFree'] = 0
			memData['physUsed'] = 0
			memData['cached'] = 0
			memData['swapFree'] = 0
			memData['swapUsed'] = 0

			# Phys
			try:
				self.mainLogger.debug('getMemoryUsage: formatting (phys)')

				physTotal = int(meminfo['MemTotal'])
				physFree = int(meminfo['MemFree'])
				physUsed = physTotal - physFree

				# Convert to MB
				memData['physFree'] = physFree / 1024
				memData['physUsed'] = physUsed / 1024
				memData['cached'] = int(meminfo['Cached']) / 1024

			# Stops the agent crashing if one of the meminfo elements isn't set
			except IndexError:
				self.mainLogger.error('getMemoryUsage: formatting (phys) IndexError - Cached, MemTotal or MemFree not present')

			except KeyError:
				self.mainLogger.error('getMemoryUsage: formatting (phys) KeyError - Cached, MemTotal or MemFree not present')

			self.mainLogger.debug('getMemoryUsage: formatted (phys)')

			# Swap
			try:
				self.mainLogger.debug('getMemoryUsage: formatting (swap)')

				swapTotal = int(meminfo['SwapTotal'])
				swapFree = int(meminfo['SwapFree'])
				swapUsed = swapTotal - swapFree

				# Convert to MB
				memData['swapFree'] = swapFree / 1024
				memData['swapUsed'] = swapUsed / 1024

			# Stops the agent crashing if one of the meminfo elements isn't set
			except IndexError:
				self.mainLogger.error('getMemoryUsage: formatting (swap) IndexError - SwapTotal or SwapFree not present')

			except KeyError:
				self.mainLogger.error('getMemoryUsage: formatting (swap) KeyError - SwapTotal or SwapFree not present')

			self.mainLogger.debug('getMemoryUsage: formatted (swap), completed, returning')

			return memData

		elif sys.platform.find('freebsd') != -1:
			self.mainLogger.debug('getMemoryUsage: freebsd (native)')

			physFree = None

			try:
				try:
					self.mainLogger.debug('getMemoryUsage: attempting sysinfo')

					proc = subprocess.Popen(['sysinfo', '-v', 'mem'], stdout = subprocess.PIPE, close_fds = True)
					sysinfo = proc.communicate()[0]

					if int(pythonVersion[1]) >= 6:
						try:
							proc.kill()
						except Exception, e:
							self.mainLogger.debug('Process already terminated')

					sysinfo = sysinfo.split('\n')

					regexp = re.compile(r'([0-9]+)') # We run this several times so one-time compile now

					for line in sysinfo:

						parts = line.split(' ')

						if parts[0] == 'Free':

							self.mainLogger.debug('getMemoryUsage: parsing free')

							for part in parts:

								match = re.search(regexp, part)

								if match != None:
									physFree = match.group(0)
									self.mainLogger.debug('getMemoryUsage: sysinfo: found free %s', physFree)

						if parts[0] == 'Active':

							self.mainLogger.debug('getMemoryUsage: parsing used')

							for part in parts:

								match = re.search(regexp, part)

								if match != None:
									physUsed = match.group(0)
									self.mainLogger.debug('getMemoryUsage: sysinfo: found used %s', physUsed)

						if parts[0] == 'Cached':

							self.mainLogger.debug('getMemoryUsage: parsing cached')

							for part in parts:

								match = re.search(regexp, part)

								if match != None:
									cached = match.group(0)
									self.mainLogger.debug('getMemoryUsage: sysinfo: found cached %s', cached)

				except OSError, e:

					self.mainLogger.debug('getMemoryUsage: sysinfo not available')

				except Exception, e:
					import traceback
					self.mainLogger.error('getMemoryUsage: exception = %s', traceback.format_exc())
			finally:
				if int(pythonVersion[1]) >= 6:
					try:
						proc.kill()
					except Exception, e:
						self.mainLogger.debug('Process already terminated')

			if physFree == None:

				self.mainLogger.info('getMemoryUsage: sysinfo not installed so falling back on sysctl. sysinfo provides more accurate memory info so is recommended. http://www.freshports.org/sysutils/sysinfo')

				try:
					try:
						self.mainLogger.debug('getMemoryUsage: attempting Popen (sysctl)')

						proc = subprocess.Popen(['sysctl', '-n', 'hw.physmem'], stdout = subprocess.PIPE, close_fds = True)
						physTotal = proc.communicate()[0]

						if int(pythonVersion[1]) >= 6:
							try:
								proc.kill()
							except Exception, e:
								self.mainLogger.debug('Process already terminated')

						self.mainLogger.debug('getMemoryUsage: attempting Popen (vmstat)')
						proc = subprocess.Popen(['vmstat', '-H'], stdout = subprocess.PIPE, close_fds = True)
						vmstat = proc.communicate()[0]

						if int(pythonVersion[1]) >= 6:
							try:
								proc.kill()
							except Exception, e:
								self.mainLogger.debug('Process already terminated')

					except Exception, e:
						import traceback
						self.mainLogger.error('getMemoryUsage: exception = %s', traceback.format_exc())

						return False
				finally:
					if int(pythonVersion[1]) >= 6:
						try:
							proc.kill()
						except Exception, e:
							self.mainLogger.debug('Process already terminated')

				self.mainLogger.debug('getMemoryUsage: Popen success, parsing')

				# First we parse the information about the real memory
				lines = vmstat.split('\n')
				physParts = lines[2].split(' ')

				physMem = []

				# We need to loop through and capture the numerical values
				# because sometimes there will be strings and spaces
				for k, v in enumerate(physParts):

					if re.match(r'([0-9]+)', v) != None:
						physMem.append(v)

				physTotal = int(physTotal.strip()) / 1024 # physFree is returned in B, but we need KB so we convert it
				physFree = int(physMem[4])
				physUsed = int(physTotal - physFree)

				self.mainLogger.debug('getMemoryUsage: parsed vmstat')

				# Convert everything to MB
				physUsed = int(physUsed) / 1024
				physFree = int(physFree) / 1024

				cached = 'NULL'

			#
			# Swap memory details
			#

			self.mainLogger.debug('getMemoryUsage: attempting Popen (swapinfo)')

			try:
				try:
					proc = subprocess.Popen(['swapinfo', '-k'], stdout = subprocess.PIPE, close_fds = True)
					swapinfo = proc.communicate()[0]

					if int(pythonVersion[1]) >= 6:
						try:
							proc.kill()
						except Exception, e:
							self.mainLogger.debug('Process already terminated')

				except Exception, e:
						import traceback
						self.mainLogger.error('getMemoryUsage: exception = %s', traceback.format_exc())

						return False
			finally:
				if int(pythonVersion[1]) >= 6:
					try:
						proc.kill()
					except Exception, e:
						self.mainLogger.debug('Process already terminated')

			lines = swapinfo.split('\n')
			swapUsed = 0
			swapFree = 0

			for index in range(1, len(lines)):
				swapParts = re.findall(r'(\d+)', lines[index])

				if swapParts != None:
					try:
						swapUsed += int(swapParts[len(swapParts) - 3]) / 1024
						swapFree += int(swapParts[len(swapParts) - 2]) / 1024
					except IndexError, e:
						pass

			self.mainLogger.debug('getMemoryUsage: parsed swapinfo, completed, returning')

			return {'physUsed' : physUsed, 'physFree' : physFree, 'swapUsed' : swapUsed, 'swapFree' : swapFree, 'cached' : cached}

		elif sys.platform == 'darwin':
			self.mainLogger.debug('getMemoryUsage: darwin')

			try:
				try:
					self.mainLogger.debug('getMemoryUsage: attempting Popen (top)')

					proc = subprocess.Popen(['top', '-l 1'], stdout=subprocess.PIPE, close_fds=True)
					top = proc.communicate()[0]

					if int(pythonVersion[1]) >= 6:
						try:
							proc.kill()
						except Exception, e:
							self.mainLogger.debug('Process already terminated')

					self.mainLogger.debug('getMemoryUsage: attempting Popen (sysctl)')
					proc = subprocess.Popen(['sysctl', 'vm.swapusage'], stdout=subprocess.PIPE, close_fds=True)
					sysctl = proc.communicate()[0]

					if int(pythonVersion[1]) >= 6:
						try:
							proc.kill()
						except Exception, e:
							self.mainLogger.debug('Process already terminated')

				except Exception, e:
					import traceback
					self.mainLogger.error('getMemoryUsage: exception = %s', traceback.format_exc())
					return False
			finally:
				if int(pythonVersion[1]) >= 6:
					try:
						proc.kill()
					except Exception, e:
						self.mainLogger.debug('Process already terminated')

			self.mainLogger.debug('getMemoryUsage: Popen success, parsing')

			# Deal with top
			lines = top.split('\n')
			physParts = re.findall(r'([0-9]\d+)', lines[self.topIndex])

			self.mainLogger.debug('getMemoryUsage: parsed top')

			# Deal with sysctl
			swapParts = re.findall(r'([0-9]+\.\d+)', sysctl)

			self.mainLogger.debug('getMemoryUsage: parsed sysctl, completed, returning')

			return {'physUsed' : physParts[3], 'physFree' : physParts[4], 'swapUsed' : swapParts[1], 'swapFree' : swapParts[2], 'cached' : 'NULL'}

		else:
			self.mainLogger.debug('getMemoryUsage: other platform, returning')
			return False

	def getMongoDBStatus(self):
		self.mainLogger.debug('getMongoDBStatus: start')

		if 'MongoDBServer' not in self.agentConfig or self.agentConfig['MongoDBServer'] == '':
			self.mainLogger.debug('getMongoDBStatus: config not set')
			return False

		self.mainLogger.debug('getMongoDBStatus: config set')

		try:
			import pymongo
			from pymongo import Connection

		except ImportError:
			self.mainLogger.error('Unable to import pymongo library')
			return False

		# The dictionary to be returned.
		mongodb = {}

		try:
			import urlparse
			parsed = urlparse.urlparse(self.agentConfig['MongoDBServer'])

			mongoURI = ''

			# Can't use attributes on Python 2.4
			if parsed[0] != 'mongodb':

				mongoURI = 'mongodb://'

				if parsed[2]:

					if parsed[0]:

						mongoURI = mongoURI + parsed[0] + ':' + parsed[2]

					else:
						mongoURI = mongoURI + parsed[2]

			else:

				mongoURI = self.agentConfig['MongoDBServer']

			self.mainLogger.debug('-- mongoURI: %s', mongoURI)

			conn = Connection(mongoURI, slave_okay=True)

			self.mainLogger.debug('Connected to MongoDB')

		except Exception, ex:
			import traceback
			self.mainLogger.error('Unable to connect to MongoDB server %s - Exception = %s', mongoURI, traceback.format_exc())
			return False

		# Older versions of pymongo did not support the command()
		# method below.
		try:
			db = conn['local']

			# Server status
			statusOutput = db.command('serverStatus') # Shorthand for {'serverStatus': 1}

			self.mainLogger.debug('getMongoDBStatus: executed serverStatus')

			# Setup
			import datetime
			status = {}

			# Version
			try:
				status['version'] = statusOutput['version']

				self.mainLogger.debug('getMongoDBStatus: version %s', statusOutput['version'])

			except KeyError, ex:
				self.mainLogger.error('getMongoDBStatus: version KeyError exception = %s', ex)
				pass

			# Global locks
			try:
				self.mainLogger.debug('getMongoDBStatus: globalLock')

				status['globalLock'] = {}
				status['globalLock']['ratio'] = statusOutput['globalLock']['ratio']

				status['globalLock']['currentQueue'] = {}
				status['globalLock']['currentQueue']['total'] = statusOutput['globalLock']['currentQueue']['total']
				status['globalLock']['currentQueue']['readers'] = statusOutput['globalLock']['currentQueue']['readers']
				status['globalLock']['currentQueue']['writers'] = statusOutput['globalLock']['currentQueue']['writers']

			except KeyError, ex:
				self.mainLogger.error('getMongoDBStatus: globalLock KeyError exception = %s', ex)
				pass

			# Memory
			try:
				self.mainLogger.debug('getMongoDBStatus: memory')

				status['mem'] = {}
				status['mem']['resident'] = statusOutput['mem']['resident']
				status['mem']['virtual'] = statusOutput['mem']['virtual']
				status['mem']['mapped'] = statusOutput['mem']['mapped']

			except KeyError, ex:
				self.mainLogger.error('getMongoDBStatus: memory KeyError exception = %s', ex)
				pass

			# Connections
			try:
				self.mainLogger.debug('getMongoDBStatus: connections')

				status['connections'] = {}
				status['connections']['current'] = statusOutput['connections']['current']
				status['connections']['available'] = statusOutput['connections']['available']

			except KeyError, ex:
				self.mainLogger.error('getMongoDBStatus: connections KeyError exception = %s', ex)
				pass

			# Extra info (Linux only)
			try:
				self.mainLogger.debug('getMongoDBStatus: extra info')

				status['extraInfo'] = {}
				status['extraInfo']['heapUsage'] = statusOutput['extra_info']['heap_usage_bytes']
				status['extraInfo']['pageFaults'] = statusOutput['extra_info']['page_faults']

			except KeyError, ex:
				self.mainLogger.debug('getMongoDBStatus: extra info KeyError exception = %s', ex)
				pass

			# Background flushing
			try:
				self.mainLogger.debug('getMongoDBStatus: backgroundFlushing')

				status['backgroundFlushing'] = {}
				delta = datetime.datetime.utcnow() - statusOutput['backgroundFlushing']['last_finished']
				status['backgroundFlushing']['secondsSinceLastFlush'] = delta.seconds
				status['backgroundFlushing']['lastFlushLength'] = statusOutput['backgroundFlushing']['last_ms']
				status['backgroundFlushing']['flushLengthAvrg'] = statusOutput['backgroundFlushing']['average_ms']

			except KeyError, ex:
				self.mainLogger.debug('getMongoDBStatus: backgroundFlushing KeyError exception = %s', ex)
				pass

			# Per second metric calculations (opcounts and asserts)
			try:
				if self.mongoDBStore == None:
					self.mainLogger.debug('getMongoDBStatus: per second metrics no cached data, so storing for first time')
					self.setMongoDBStore(statusOutput)

				else:
					self.mainLogger.debug('getMongoDBStatus: per second metrics cached data exists')

					accessesPS = float(statusOutput['indexCounters']['btree']['accesses'] - self.mongoDBStore['indexCounters']['btree']['accessesPS']) / 60

					if accessesPS >= 0:
						status['indexCounters'] = {}
						status['indexCounters']['btree'] = {}
						status['indexCounters']['btree']['accessesPS'] = accessesPS
						status['indexCounters']['btree']['hitsPS'] = float(statusOutput['indexCounters']['btree']['hits'] - self.mongoDBStore['indexCounters']['btree']['hitsPS']) / 60
						status['indexCounters']['btree']['missesPS'] = float(statusOutput['indexCounters']['btree']['misses'] - self.mongoDBStore['indexCounters']['btree']['missesPS']) / 60
						status['indexCounters']['btree']['missRatioPS'] = float(statusOutput['indexCounters']['btree']['missRatio'] - self.mongoDBStore['indexCounters']['btree']['missRatioPS']) / 60

						status['opcounters'] = {}
						status['opcounters']['insertPS'] = float(statusOutput['opcounters']['insert'] - self.mongoDBStore['opcounters']['insertPS']) / 60
						status['opcounters']['queryPS'] = float(statusOutput['opcounters']['query'] - self.mongoDBStore['opcounters']['queryPS']) / 60
						status['opcounters']['updatePS'] = float(statusOutput['opcounters']['update'] - self.mongoDBStore['opcounters']['updatePS']) / 60
						status['opcounters']['deletePS'] = float(statusOutput['opcounters']['delete'] - self.mongoDBStore['opcounters']['deletePS']) / 60
						status['opcounters']['getmorePS'] = float(statusOutput['opcounters']['getmore'] - self.mongoDBStore['opcounters']['getmorePS']) / 60
						status['opcounters']['commandPS'] = float(statusOutput['opcounters']['command'] - self.mongoDBStore['opcounters']['commandPS']) / 60

						status['asserts'] = {}
						status['asserts']['regularPS'] = float(statusOutput['asserts']['regular'] - self.mongoDBStore['asserts']['regularPS']) / 60
						status['asserts']['warningPS'] = float(statusOutput['asserts']['warning'] - self.mongoDBStore['asserts']['warningPS']) / 60
						status['asserts']['msgPS'] = float(statusOutput['asserts']['msg'] - self.mongoDBStore['asserts']['msgPS']) / 60
						status['asserts']['userPS'] = float(statusOutput['asserts']['user'] - self.mongoDBStore['asserts']['userPS']) / 60
						status['asserts']['rolloversPS'] = float(statusOutput['asserts']['rollovers'] - self.mongoDBStore['asserts']['rolloversPS']) / 60

						self.setMongoDBStore(statusOutput)
					else:
						self.mainLogger.debug('getMongoDBStatus: per second metrics negative value calculated, mongod likely restarted, so clearing cache')
						self.setMongoDBStore(statusOutput)

			except KeyError, ex:
				self.mainLogger.error('getMongoDBStatus: per second metrics KeyError exception = %s', ex)
				pass

			# Cursors
			try:
				self.mainLogger.debug('getMongoDBStatus: cursors')

				status['cursors'] = {}
				status['cursors']['totalOpen'] = statusOutput['cursors']['totalOpen']

			except KeyError, ex:
				self.mainLogger.error('getMongoDBStatus: cursors KeyError exception = %s', ex)
				pass

			# Replica set status
			if 'MongoDBReplSet' in self.agentConfig and self.agentConfig['MongoDBReplSet'] == 'yes':
				self.mainLogger.debug('getMongoDBStatus: get replset status too')

				# isMaster (to get state
				isMaster = db.command('isMaster')

				self.mainLogger.debug('getMongoDBStatus: executed isMaster')

				status['replSet'] = {}
				status['replSet']['setName'] = isMaster['setName']
				status['replSet']['isMaster'] = isMaster['ismaster']
				status['replSet']['isSecondary'] = isMaster['secondary']

				if 'arbiterOnly' in isMaster:
					status['replSet']['isArbiter'] = isMaster['arbiterOnly']

				self.mainLogger.debug('getMongoDBStatus: finished isMaster')

				# rs.status()
				db = conn['admin']
				replSet = db.command('replSetGetStatus')

				self.mainLogger.debug('getMongoDBStatus: executed replSetGetStatus')

				status['replSet']['myState'] = replSet['myState']

				status['replSet']['members'] = {}

				for member in replSet['members']:

					self.mainLogger.debug('getMongoDBStatus: replSetGetStatus looping %s', member['name'])

					status['replSet']['members'][str(member['_id'])] = {}

					status['replSet']['members'][str(member['_id'])]['name'] = member['name']
					status['replSet']['members'][str(member['_id'])]['state'] = member['state']

					# Optime delta (only available from not self)
					# Calculation is from http://docs.python.org/library/datetime.html#datetime.timedelta.total_seconds
					if 'optimeDate' in member: # Only available as of 1.7.2
						deltaOptime = datetime.datetime.utcnow() - member['optimeDate']
						status['replSet']['members'][str(member['_id'])]['optimeDate'] = (deltaOptime.microseconds + (deltaOptime.seconds + deltaOptime.days * 24 * 3600) * 10**6) / 10**6

					if 'self' in member:
						status['replSet']['myId'] = member['_id']

					# Have to do it manually because total_seconds() is only available as of Python 2.7
					else:
						if 'lastHeartbeat' in member:
							deltaHeartbeat = datetime.datetime.utcnow() - member['lastHeartbeat']
							status['replSet']['members'][str(member['_id'])]['lastHeartbeat'] = (deltaHeartbeat.microseconds + (deltaHeartbeat.seconds + deltaHeartbeat.days * 24 * 3600) * 10**6) / 10**6

					if 'errmsg' in member:
						status['replSet']['members'][str(member['_id'])]['error'] = member['errmsg']

			# db.stats()
			if 'MongoDBDBStats' in self.agentConfig and self.agentConfig['MongoDBDBStats'] == 'yes':
				self.mainLogger.debug('getMongoDBStatus: db.stats() too')

				status['dbStats'] = {}

				for database in conn.database_names():

					if database != 'config' and database != 'local' and database != 'admin' and database != 'test':

						self.mainLogger.debug('getMongoDBStatus: executing db.stats() for %s', database)

						status['dbStats'][database] = conn[database].command('dbstats')
						status['dbStats'][database]['namespaces'] = conn[database]['system']['namespaces'].count()

						# Ensure all strings to prevent JSON parse errors. We typecast on the server
						for key in status['dbStats'][database].keys():

							status['dbStats'][database][key] = str(status['dbStats'][database][key])


		except Exception, ex:
			import traceback
			self.mainLogger.error('Unable to get MongoDB status - Exception = %s', traceback.format_exc())
			return False

		self.mainLogger.debug('getMongoDBStatus: completed, returning')

		return status

	def setMongoDBStore(self, statusOutput):
		self.mongoDBStore = {}

		self.mongoDBStore['indexCounters'] = {}
		self.mongoDBStore['indexCounters']['btree'] = {}
		self.mongoDBStore['indexCounters']['btree']['accessesPS'] = statusOutput['indexCounters']['btree']['accesses']
		self.mongoDBStore['indexCounters']['btree']['hitsPS'] = statusOutput['indexCounters']['btree']['hits']
		self.mongoDBStore['indexCounters']['btree']['missesPS'] = statusOutput['indexCounters']['btree']['misses']
		self.mongoDBStore['indexCounters']['btree']['missRatioPS'] = statusOutput['indexCounters']['btree']['missRatio']

		self.mongoDBStore['opcounters'] = {}
		self.mongoDBStore['opcounters']['insertPS'] = statusOutput['opcounters']['insert']
		self.mongoDBStore['opcounters']['queryPS'] = statusOutput['opcounters']['query']
		self.mongoDBStore['opcounters']['updatePS'] = statusOutput['opcounters']['update']
		self.mongoDBStore['opcounters']['deletePS'] = statusOutput['opcounters']['delete']
		self.mongoDBStore['opcounters']['getmorePS'] = statusOutput['opcounters']['getmore']
		self.mongoDBStore['opcounters']['commandPS'] = statusOutput['opcounters']['command']

		self.mongoDBStore['asserts'] = {}
		self.mongoDBStore['asserts']['regularPS'] = statusOutput['asserts']['regular']
		self.mongoDBStore['asserts']['warningPS'] = statusOutput['asserts']['warning']
		self.mongoDBStore['asserts']['msgPS'] = statusOutput['asserts']['msg']
		self.mongoDBStore['asserts']['userPS'] = statusOutput['asserts']['user']
		self.mongoDBStore['asserts']['rolloversPS'] = statusOutput['asserts']['rollovers']

	def getMySQLStatus(self):
		self.mainLogger.debug('getMySQLStatus: start')

		if 'MySQLServer' in self.agentConfig and 'MySQLUser' in self.agentConfig and self.agentConfig['MySQLServer'] != '' and self.agentConfig['MySQLUser'] != '':

			self.mainLogger.debug('getMySQLStatus: config')

			# Try import MySQLdb - http://sourceforge.net/projects/mysql-python/files/
			try:
				import MySQLdb

			except ImportError, e:
				self.mainLogger.error('getMySQLStatus: unable to import MySQLdb')
				return False

			if 'MySQLPort' not in self.agentConfig:

				self.agentConfig['MySQLPort'] = 3306

			if 'MySQLSocket' not in self.agentConfig:

				# Connect
				try:
					db = MySQLdb.connect(host=self.agentConfig['MySQLServer'], user=self.agentConfig['MySQLUser'], passwd=self.agentConfig['MySQLPass'], port=int(self.agentConfig['MySQLPort']))

				except MySQLdb.OperationalError, message:

					self.mainLogger.error('getMySQLStatus: MySQL connection error (server): %s', message)
					return False

			else:

				# Connect
				try:
					db = MySQLdb.connect(host='localhost', user=self.agentConfig['MySQLUser'], passwd=self.agentConfig['MySQLPass'], port=int(self.agentConfig['MySQLPort']), unix_socket=self.agentConfig['MySQLSocket'])

				except MySQLdb.OperationalError, message:

					self.mainLogger.error('getMySQLStatus: MySQL connection error (socket): %s', message)
					return False

			self.mainLogger.debug('getMySQLStatus: connected')

			# Get MySQL version
			if self.mysqlVersion == None:

				self.mainLogger.debug('getMySQLStatus: mysqlVersion unset storing for first time')

				try:
					cursor = db.cursor()
					cursor.execute('SELECT VERSION()')
					result = cursor.fetchone()

				except MySQLdb.OperationalError, message:

					self.mainLogger.error('getMySQLStatus: MySQL query error when getting version: %s', message)

				version = result[0].split('-') # Case 31237. Might include a description e.g. 4.1.26-log. See http://dev.mysql.com/doc/refman/4.1/en/information-functions.html#function_version
				version = version[0].split('.')

				self.mysqlVersion = []

				# Make sure the version is only an int. Case 31647
				for string in version:
					number = re.match('([0-9]+)', string)
					number = number.group(0)
					self.mysqlVersion.append(number)

			self.mainLogger.debug('getMySQLStatus: getting Connections')

			# Connections
			try:
				cursor = db.cursor()
				cursor.execute('SHOW STATUS LIKE "Connections"')
				result = cursor.fetchone()

			except MySQLdb.OperationalError, message:

				self.mainLogger.error('getMySQLStatus: MySQL query error when getting Connections = %s', message)

			if self.mysqlConnectionsStore == None:

				self.mainLogger.debug('getMySQLStatus: mysqlConnectionsStore unset storing for first time')

				self.mysqlConnectionsStore = result[1]

				connections = 0

			else:

				self.mainLogger.debug('getMySQLStatus: mysqlConnectionsStore set so calculating')
				self.mainLogger.debug('getMySQLStatus: self.mysqlConnectionsStore = %s', self.mysqlConnectionsStore)
				self.mainLogger.debug('getMySQLStatus: result = %s', result[1])

				connections = float(float(result[1]) - float(self.mysqlConnectionsStore)) / 60

				self.mysqlConnectionsStore = result[1]

			self.mainLogger.debug('getMySQLStatus: connections  = %s', connections)

			self.mainLogger.debug('getMySQLStatus: getting Connections - done')

			self.mainLogger.debug('getMySQLStatus: getting Created_tmp_disk_tables')

			# Created_tmp_disk_tables

			# Determine query depending on version. For 5.02 and above we need the GLOBAL keyword (case 31015)
			if int(self.mysqlVersion[0]) >= 5 and int(self.mysqlVersion[2]) >= 2:
				query = 'SHOW GLOBAL STATUS LIKE "Created_tmp_disk_tables"'

			else:
				query = 'SHOW STATUS LIKE "Created_tmp_disk_tables"'

			try:
				cursor = db.cursor()
				cursor.execute(query)
				result = cursor.fetchone()

			except MySQLdb.OperationalError, message:

				self.mainLogger.error('getMySQLStatus: MySQL query error when getting Created_tmp_disk_tables = %s', message)

			createdTmpDiskTables = float(result[1])

			self.mainLogger.debug('getMySQLStatus: createdTmpDiskTables = %s', createdTmpDiskTables)

			self.mainLogger.debug('getMySQLStatus: getting Created_tmp_disk_tables - done')

			self.mainLogger.debug('getMySQLStatus: getting Max_used_connections')

			# Max_used_connections
			try:
				cursor = db.cursor()
				cursor.execute('SHOW STATUS LIKE "Max_used_connections"')
				result = cursor.fetchone()

			except MySQLdb.OperationalError, message:

				self.mainLogger.error('getMySQLStatus: MySQL query error when getting Max_used_connections = %s', message)

			maxUsedConnections = result[1]

			self.mainLogger.debug('getMySQLStatus: maxUsedConnections = %s', createdTmpDiskTables)

			self.mainLogger.debug('getMySQLStatus: getting Max_used_connections - done')

			self.mainLogger.debug('getMySQLStatus: getting Open_files')

			# Open_files
			try:
				cursor = db.cursor()
				cursor.execute('SHOW STATUS LIKE "Open_files"')
				result = cursor.fetchone()

			except MySQLdb.OperationalError, message:

				self.mainLogger.error('getMySQLStatus: MySQL query error when getting Open_files = %s', message)

			openFiles = result[1]

			self.mainLogger.debug('getMySQLStatus: openFiles = %s', openFiles)

			self.mainLogger.debug('getMySQLStatus: getting Open_files - done')

			self.mainLogger.debug('getMySQLStatus: getting Slow_queries')

			# Slow_queries

			# Determine query depending on version. For 5.02 and above we need the GLOBAL keyword (case 31015)
			if int(self.mysqlVersion[0]) >= 5 and int(self.mysqlVersion[2]) >= 2:
				query = 'SHOW GLOBAL STATUS LIKE "Slow_queries"'

			else:
				query = 'SHOW STATUS LIKE "Slow_queries"'

			try:
				cursor = db.cursor()
				cursor.execute(query)
				result = cursor.fetchone()

			except MySQLdb.OperationalError, message:

				self.mainLogger.error('getMySQLStatus: MySQL query error when getting Slow_queries = %s', message)

			if self.mysqlSlowQueriesStore == None:

				self.mainLogger.debug('getMySQLStatus: mysqlSlowQueriesStore unset so storing for first time')

				self.mysqlSlowQueriesStore = result[1]

				slowQueries = 0

			else:

				self.mainLogger.debug('getMySQLStatus: mysqlSlowQueriesStore set so calculating')
				self.mainLogger.debug('getMySQLStatus: self.mysqlSlowQueriesStore = %s', self.mysqlSlowQueriesStore)
				self.mainLogger.debug('getMySQLStatus: result = %s', result[1])

				slowQueries = float(float(result[1]) - float(self.mysqlSlowQueriesStore)) / 60

				self.mysqlSlowQueriesStore = result[1]

			self.mainLogger.debug('getMySQLStatus: slowQueries = %s', slowQueries)

			self.mainLogger.debug('getMySQLStatus: getting Slow_queries - done')

			self.mainLogger.debug('getMySQLStatus: getting Table_locks_waited')

			# Table_locks_waited
			try:
				cursor = db.cursor()
				cursor.execute('SHOW STATUS LIKE "Table_locks_waited"')
				result = cursor.fetchone()

			except MySQLdb.OperationalError, message:

				self.mainLogger.error('getMySQLStatus: MySQL query error when getting Table_locks_waited = %s', message)

			tableLocksWaited = float(result[1])

			self.mainLogger.debug('getMySQLStatus: tableLocksWaited  = %s', tableLocksWaited)

			self.mainLogger.debug('getMySQLStatus: getting Table_locks_waited - done')

			self.mainLogger.debug('getMySQLStatus: getting Threads_connected')

			# Threads_connected
			try:
				cursor = db.cursor()
				cursor.execute('SHOW STATUS LIKE "Threads_connected"')
				result = cursor.fetchone()

			except MySQLdb.OperationalError, message:

				self.mainLogger.error('getMySQLStatus: MySQL query error when getting Threads_connected = %s', message)

			threadsConnected = result[1]

			self.mainLogger.debug('getMySQLStatus: threadsConnected = %s', threadsConnected)

			self.mainLogger.debug('getMySQLStatus: getting Threads_connected - done')

			self.mainLogger.debug('getMySQLStatus: getting Seconds_Behind_Master')

			if 'MySQLNoRepl' not in self.agentConfig:
				# Seconds_Behind_Master
				try:
					cursor = db.cursor(MySQLdb.cursors.DictCursor)
					cursor.execute('SHOW SLAVE STATUS')
					result = cursor.fetchone()

				except MySQLdb.OperationalError, message:

					self.mainLogger.error('getMySQLStatus: MySQL query error when getting SHOW SLAVE STATUS = %s', message)
					result = None

				if result != None:
					try:
						secondsBehindMaster = result['Seconds_Behind_Master']

						self.mainLogger.debug('getMySQLStatus: secondsBehindMaster = %s', secondsBehindMaster)

					except IndexError, e:
						secondsBehindMaster = None

						self.mainLogger.debug('getMySQLStatus: secondsBehindMaster empty. %s', e)

				else:
					secondsBehindMaster = None

					self.mainLogger.debug('getMySQLStatus: secondsBehindMaster empty. Result = None.')

				self.mainLogger.debug('getMySQLStatus: getting Seconds_Behind_Master - done')

			return {'connections' : connections, 'createdTmpDiskTables' : createdTmpDiskTables, 'maxUsedConnections' : maxUsedConnections, 'openFiles' : openFiles, 'slowQueries' : slowQueries, 'tableLocksWaited' : tableLocksWaited, 'threadsConnected' : threadsConnected, 'secondsBehindMaster' : secondsBehindMaster}

		else:

			self.mainLogger.debug('getMySQLStatus: config not set')
			return False

	def getNetworkTraffic(self):
		self.mainLogger.debug('getNetworkTraffic: start')

		if sys.platform == 'linux2':
			self.mainLogger.debug('getNetworkTraffic: linux2')

			try:
				self.mainLogger.debug('getNetworkTraffic: attempting open')

				proc = open('/proc/net/dev', 'r')
				lines = proc.readlines()

				proc.close()

			except IOError, e:
				self.mainLogger.error('getNetworkTraffic: exception = %s', e)
				return False

			self.mainLogger.debug('getNetworkTraffic: open success, parsing')

			columnLine = lines[1]
			_, receiveCols , transmitCols = columnLine.split('|')
			receiveCols = map(lambda a:'recv_' + a, receiveCols.split())
			transmitCols = map(lambda a:'trans_' + a, transmitCols.split())

			cols = receiveCols + transmitCols

			self.mainLogger.debug('getNetworkTraffic: parsing, looping')

			faces = {}
			for line in lines[2:]:
				if line.find(':') < 0: continue
				face, data = line.split(':')
				faceData = dict(zip(cols, data.split()))
				faces[face] = faceData

			self.mainLogger.debug('getNetworkTraffic: parsed, looping')

			interfaces = {}

			# Now loop through each interface
			for face in faces:
				key = face.strip()

				# We need to work out the traffic since the last check so first time we store the current value
				# then the next time we can calculate the difference
				try:
					if key in self.networkTrafficStore:
						interfaces[key] = {}
						interfaces[key]['recv_bytes'] = long(faces[face]['recv_bytes']) - long(self.networkTrafficStore[key]['recv_bytes'])
						interfaces[key]['trans_bytes'] = long(faces[face]['trans_bytes']) - long(self.networkTrafficStore[key]['trans_bytes'])

						if interfaces[key]['recv_bytes'] < 0:
							interfaces[key]['recv_bytes'] = long(faces[face]['recv_bytes'])

						if interfaces[key]['trans_bytes'] < 0:
							interfaces[key]['trans_bytes'] = long(faces[face]['trans_bytes'])

						interfaces[key]['recv_bytes'] = str(interfaces[key]['recv_bytes'])
						interfaces[key]['trans_bytes'] = str(interfaces[key]['trans_bytes'])

						# And update the stored value to subtract next time round
						self.networkTrafficStore[key]['recv_bytes'] = faces[face]['recv_bytes']
						self.networkTrafficStore[key]['trans_bytes'] = faces[face]['trans_bytes']

					else:
						self.networkTrafficStore[key] = {}
						self.networkTrafficStore[key]['recv_bytes'] = faces[face]['recv_bytes']
						self.networkTrafficStore[key]['trans_bytes'] = faces[face]['trans_bytes']

					# Logging
					self.mainLogger.debug('getNetworkTraffic: %s = %s', key, self.networkTrafficStore[key]['recv_bytes'])
					self.mainLogger.debug('getNetworkTraffic: %s = %s', key, self.networkTrafficStore[key]['trans_bytes'])

				except KeyError, ex:
					self.mainLogger.error('getNetworkTraffic: no data for %s', key)

				except ValueError, ex:
					self.mainLogger.error('getNetworkTraffic: invalid data for %s', key)

			self.mainLogger.debug('getNetworkTraffic: completed, returning')

			return interfaces

		elif sys.platform.find('freebsd') != -1:
			self.mainLogger.debug('getNetworkTraffic: freebsd')

			try:
				try:
					self.mainLogger.debug('getNetworkTraffic: attempting Popen (netstat)')

					proc = subprocess.Popen(['netstat', '-nbid'], stdout=subprocess.PIPE, close_fds=True)
					netstat = proc.communicate()[0]

					if int(pythonVersion[1]) >= 6:
						try:
							proc.kill()
						except Exception, e:
							self.mainLogger.debug('Process already terminated')

				except Exception, e:
					import traceback
					self.mainLogger.error('getNetworkTraffic: exception = %s', traceback.format_exc())

					return False
			finally:
				if int(pythonVersion[1]) >= 6:
					try:
						proc.kill()
					except Exception, e:
						self.mainLogger.debug('Process already terminated')

			self.mainLogger.debug('getNetworkTraffic: open success, parsing')

			lines = netstat.split('\n')

			# Loop over available data for each inteface
			faces = {}
			rxKey = None
			txKey = None

			for line in lines:
				self.mainLogger.debug('getNetworkTraffic: %s', line)

				line = re.split(r'\s+', line)

				# Figure out which index we need
				if rxKey == None and txKey == None:
					for k, part in enumerate(line):
						self.mainLogger.debug('getNetworkTraffic: looping parts (%s)', part)

						if part == 'Ibytes':
							rxKey = k
							self.mainLogger.debug('getNetworkTraffic: found rxKey = %s', k)
						elif part == 'Obytes':
							txKey = k
							self.mainLogger.debug('getNetworkTraffic: found txKey = %s', k)

				else:
					if line[0] not in faces:
						try:
							self.mainLogger.debug('getNetworkTraffic: parsing (rx: %s = %s / tx: %s = %s)', rxKey, line[rxKey], txKey, line[txKey])
							faceData = {'recv_bytes': line[rxKey], 'trans_bytes': line[txKey]}

							face = line[0]
							faces[face] = faceData
						except IndexError, e:
							continue

			self.mainLogger.debug('getNetworkTraffic: parsed, looping')

			interfaces = {}

			# Now loop through each interface
			for face in faces:
				key = face.strip()

				try:
					# We need to work out the traffic since the last check so first time we store the current value
					# then the next time we can calculate the difference
					if key in self.networkTrafficStore:
						interfaces[key] = {}
						interfaces[key]['recv_bytes'] = long(faces[face]['recv_bytes']) - long(self.networkTrafficStore[key]['recv_bytes'])
						interfaces[key]['trans_bytes'] = long(faces[face]['trans_bytes']) - long(self.networkTrafficStore[key]['trans_bytes'])

						interfaces[key]['recv_bytes'] = str(interfaces[key]['recv_bytes'])
						interfaces[key]['trans_bytes'] = str(interfaces[key]['trans_bytes'])

						if interfaces[key]['recv_bytes'] < 0:
							interfaces[key]['recv_bytes'] = long(faces[face]['recv_bytes'])

						if interfaces[key]['trans_bytes'] < 0:
							interfaces[key]['trans_bytes'] = long(faces[face]['trans_bytes'])

						# And update the stored value to subtract next time round
						self.networkTrafficStore[key]['recv_bytes'] = faces[face]['recv_bytes']
						self.networkTrafficStore[key]['trans_bytes'] = faces[face]['trans_bytes']

					else:
						self.networkTrafficStore[key] = {}
						self.networkTrafficStore[key]['recv_bytes'] = faces[face]['recv_bytes']
						self.networkTrafficStore[key]['trans_bytes'] = faces[face]['trans_bytes']

				except KeyError, ex:
					self.mainLogger.error('getNetworkTraffic: no data for %s', key)

				except ValueError, ex:
					self.mainLogger.error('getNetworkTraffic: invalid data for %s', key)

			self.mainLogger.debug('getNetworkTraffic: completed, returning')

			return interfaces

		else:
			self.mainLogger.debug('getNetworkTraffic: other platform, returning')

			return False

	def getNginxStatus(self):
		self.mainLogger.debug('getNginxStatus: start')

		if 'nginxStatusUrl' in self.agentConfig and self.agentConfig['nginxStatusUrl'] != 'http://www.example.com/nginx_status':	# Don't do it if the status URL hasn't been provided
			self.mainLogger.debug('getNginxStatus: config set')

			try:
				self.mainLogger.debug('getNginxStatus: attempting urlopen')

				req = urllib2.Request(self.agentConfig['nginxStatusUrl'], None, headers)

				# Do the request, log any errors
				request = urllib2.urlopen(req)
				response = request.read()

			except urllib2.HTTPError, e:
				self.mainLogger.error('Unable to get Nginx status - HTTPError = %s', e)
				return False

			except urllib2.URLError, e:
				self.mainLogger.error('Unable to get Nginx status - URLError = %s', e)
				return False

			except httplib.HTTPException, e:
				self.mainLogger.error('Unable to get Nginx status - HTTPException = %s', e)
				return False

			except Exception, e:
				import traceback
				self.mainLogger.error('Unable to get Nginx status - Exception = %s', traceback.format_exc())
				return False

			self.mainLogger.debug('getNginxStatus: urlopen success, start parsing')

			# Thanks to http://hostingfu.com/files/nginx/nginxstats.py for this code

			self.mainLogger.debug('getNginxStatus: parsing connections')

			try:
				# Connections
				parsed = re.search(r'Active connections:\s+(\d+)', response)
				connections = int(parsed.group(1))

				self.mainLogger.debug('getNginxStatus: parsed connections')
				self.mainLogger.debug('getNginxStatus: parsing reqs')

				# Requests per second
				parsed = re.search(r'\s*(\d+)\s+(\d+)\s+(\d+)', response)

				if not parsed:
					self.mainLogger.debug('getNginxStatus: could not parse response')
					return False

				requests = int(parsed.group(3))

				self.mainLogger.debug('getNginxStatus: parsed reqs')

				if self.nginxRequestsStore == None or self.nginxRequestsStore < 0:

					self.mainLogger.debug('getNginxStatus: no reqs so storing for first time')

					self.nginxRequestsStore = requests

					requestsPerSecond = 0

				else:

					self.mainLogger.debug('getNginxStatus: reqs stored so calculating')
					self.mainLogger.debug('getNginxStatus: self.nginxRequestsStore = %s', self.nginxRequestsStore)
					self.mainLogger.debug('getNginxStatus: requests = %s', requests)

					requestsPerSecond = float(requests - self.nginxRequestsStore) / 60

					self.mainLogger.debug('getNginxStatus: requestsPerSecond = %s', requestsPerSecond)

					self.nginxRequestsStore = requests

				if connections != None and requestsPerSecond != None:

					self.mainLogger.debug('getNginxStatus: returning with data')

					return {'connections' : connections, 'reqPerSec' : requestsPerSecond}

				else:

					self.mainLogger.debug('getNginxStatus: returning without data')

					return False

			except Exception, e:
				import traceback
				self.mainLogger.error('Unable to get Nginx status - %s - Exception = %s', response, traceback.format_exc())
				return False

		else:
			self.mainLogger.debug('getNginxStatus: config not set')

			return False

	def getProcesses(self):
		self.mainLogger.debug('getProcesses: start')

		# Get output from ps
		try:
			try:
				self.mainLogger.debug('getProcesses: attempting Popen')

				proc = subprocess.Popen(['ps', 'auxww'], stdout=subprocess.PIPE, close_fds=True)
				ps = proc.communicate()[0]

				if int(pythonVersion[1]) >= 6:
					try:
						proc.kill()
					except Exception, e:
						self.mainLogger.debug('Process already terminated')

				self.mainLogger.debug('getProcesses: ps result = %s', ps)

			except Exception, e:
				import traceback
				self.mainLogger.error('getProcesses: exception = %s', traceback.format_exc())
				return False
		finally:
			if int(pythonVersion[1]) >= 6:
				try:
					proc.kill()
				except Exception, e:
					self.mainLogger.debug('Process already terminated')

		self.mainLogger.debug('getProcesses: Popen success, parsing')

		# Split out each process
		processLines = ps.split('\n')

		del processLines[0] # Removes the headers
		processLines.pop() # Removes a trailing empty line

		processes = []

		self.mainLogger.debug('getProcesses: Popen success, parsing, looping')

		for line in processLines:
			self.mainLogger.debug('getProcesses: Popen success, parsing, loop...')
			line = line.replace("'", '') # These will break JSON. ZD38282
			line = line.replace('"', '')
			line = line.replace('\\', '\\\\')
			line = line.split(None, 10)
			processes.append(line)

		self.mainLogger.debug('getProcesses: completed, returning')

		return processes

	def getRabbitMQStatus(self):
		self.mainLogger.debug('getRabbitMQStatus: start')

		if 'rabbitMQStatusUrl' not in self.agentConfig or \
                    'rabbitMQUser' not in self.agentConfig or \
                    'rabbitMQPass' not in self.agentConfig or \
			self.agentConfig['rabbitMQStatusUrl'] == 'http://www.example.com:55672/json':

			self.mainLogger.debug('getRabbitMQStatus: config not set')
			return False

		self.mainLogger.debug('getRabbitMQStatus: config set')

		try:
			self.mainLogger.debug('getRabbitMQStatus: attempting authentication setup')

			manager = urllib2.HTTPPasswordMgrWithDefaultRealm()
			manager.add_password(None, self.agentConfig['rabbitMQStatusUrl'], self.agentConfig['rabbitMQUser'], self.agentConfig['rabbitMQPass'])
			handler = urllib2.HTTPBasicAuthHandler(manager)
			opener = urllib2.build_opener(handler)
			urllib2.install_opener(opener)

			self.mainLogger.debug('getRabbitMQStatus: attempting urlopen')
			req = urllib2.Request(self.agentConfig['rabbitMQStatusUrl'], None, headers)

			# Do the request, log any errors
			request = urllib2.urlopen(req)
			response = request.read()

		except urllib2.HTTPError, e:
			self.mainLogger.error('Unable to get RabbitMQ status - HTTPError = %s', e)
			return False

		except urllib2.URLError, e:
			self.mainLogger.error('Unable to get RabbitMQ status - URLError = %s', e)
			return False

		except httplib.HTTPException, e:
			self.mainLogger.error('Unable to get RabbitMQ status - HTTPException = %s', e)
			return False

		except Exception, e:
			import traceback
			self.mainLogger.error('Unable to get RabbitMQ status - Exception = %s', traceback.format_exc())
			return False

		try:				
			if int(pythonVersion[1]) >= 6:
				self.mainLogger.debug('getRabbitMQStatus: json read')
				status = json.loads(response)

			else:
				self.mainLogger.debug('getRabbitMQStatus: minjson read')
				status = minjson.safeRead(response)

			self.mainLogger.debug(status)

			if 'connections' not in status:
				# We are probably using the newer RabbitMQ 2.x status plugin, so try to parse that instead.
				status = {}
				connections = {}
				queues = {}
				self.mainLogger.debug('getRabbitMQStatus: using 2.x management plugin data')
				import urlparse

				split_url = urlparse.urlsplit(self.agentConfig['rabbitMQStatusUrl'])

				# Connections
				url = split_url[0] + '://' + split_url[1] + '/api/connections'
				self.mainLogger.debug('getRabbitMQStatus: attempting urlopen on %s', url)
				manager.add_password(None, url, self.agentConfig['rabbitMQUser'], self.agentConfig['rabbitMQPass'])
				req = urllib2.Request(url, None, headers)
				# Do the request, log any errors
				request = urllib2.urlopen(req)
				response = request.read()

				if int(pythonVersion[1]) >= 6:
					self.mainLogger.debug('getRabbitMQStatus: connections json read')
					connections = json.loads(response)
				else:
					self.mainLogger.debug('getRabbitMQStatus: connections minjson read')
					connections = minjson.safeRead(response)

				status['connections'] = len(connections)
				self.mainLogger.debug('getRabbitMQStatus: connections = %s', status['connections'])

				# Queues
				url = split_url[0] + '://' + split_url[1] + '/api/queues'
				self.mainLogger.debug('getRabbitMQStatus: attempting urlopen on %s', url)
				manager.add_password(None, url, self.agentConfig['rabbitMQUser'], self.agentConfig['rabbitMQPass'])
				req = urllib2.Request(url, None, headers)
				# Do the request, log any errors
				request = urllib2.urlopen(req)
				response = request.read()

				if int(pythonVersion[1]) >= 6:
					self.mainLogger.debug('getRabbitMQStatus: queues json read')
					queues = json.loads(response)
				else:
					self.mainLogger.debug('getRabbitMQStatus: queues minjson read')
					queues = minjson.safeRead(response)

				status['queues'] = queues
				self.mainLogger.debug(status['queues'])

		except Exception, e:
			import traceback
			self.mainLogger.error('Unable to load RabbitMQ status JSON - Exception = %s', traceback.format_exc())
			return False

		self.mainLogger.debug('getRabbitMQStatus: completed, returning')

		# Fix for queues with the same name (case 32788)
		for queue in status.get('queues', []):
			vhost = queue.get('vhost', '/')
			if vhost == '/':
				continue

			queue['name'] = '%s/%s' % (vhost, queue['name'])

		return status

	#
	# Plugins
	#

	def getPlugins(self):
		self.mainLogger.debug('getPlugins: start')

		if 'pluginDirectory' in self.agentConfig and self.agentConfig['pluginDirectory'] != '':

			self.mainLogger.info('getPlugins: pluginDirectory %s', self.agentConfig['pluginDirectory'])

			if os.access(self.agentConfig['pluginDirectory'], os.R_OK) == False:
				self.mainLogger.warning('getPlugins: Plugin path %s is set but not readable by agent. Skipping plugins.', self.agentConfig['pluginDirectory'])

				return False

		else:
			self.mainLogger.debug('getPlugins: pluginDirectory not set')

			return False

		# Have we already imported the plugins?
		# Only load the plugins once
		if self.plugins == None:
			self.mainLogger.debug('getPlugins: initial load from %s', self.agentConfig['pluginDirectory'])

			sys.path.append(self.agentConfig['pluginDirectory'])

			self.plugins = []
			plugins = []

			# Loop through all the plugin files
			for root, dirs, files in os.walk(self.agentConfig['pluginDirectory']):
				for name in files:
					self.mainLogger.debug('getPlugins: considering: %s', name)

					name = name.split('.', 1)

					# Only pull in .py files (ignores others, inc .pyc files)
					try:
						if name[1] == 'py':

							self.mainLogger.debug('getPlugins: ' + name[0] + '.' + name[1] + ' is a plugin')

							plugins.append(name[0])

					except IndexError, e:

						continue

			# Loop through all the found plugins, import them then create new objects
			for pluginName in plugins:
				self.mainLogger.debug('getPlugins: loading %s', pluginName)

				pluginPath = os.path.join(self.agentConfig['pluginDirectory'], '%s.py' % pluginName)

				if os.access(pluginPath, os.R_OK) == False:
					self.mainLogger.error('getPlugins: Unable to read %s so skipping this plugin.', pluginPath)
					continue

				try:
					# Import the plugin, but only from the pluginDirectory (ensures no conflicts with other module names elsehwhere in the sys.path
					import imp
					importedPlugin = imp.load_source(pluginName, pluginPath)

					self.mainLogger.debug('getPlugins: imported %s', pluginName)

					# Find out the class name and then instantiate it
					pluginClass = getattr(importedPlugin, pluginName)

					try:
						pluginObj = pluginClass(self.agentConfig, self.mainLogger, self.rawConfig)

					except TypeError:

						try:
							pluginObj = pluginClass(self.agentConfig, self.mainLogger)
						except TypeError:
							# Support older plugins.
							pluginObj = pluginClass()

					self.mainLogger.debug('getPlugins: instantiated %s', pluginName)

					# Store in class var so we can execute it again on the next cycle
					self.plugins.append(pluginObj)

				except Exception, ex:
					import traceback
					self.mainLogger.error('getPlugins (%s): exception = %s', pluginName, traceback.format_exc())

		# Now execute the objects previously created
		if self.plugins != None:
			self.mainLogger.debug('getPlugins: executing plugins')

			# Execute the plugins
			output = {}

			for plugin in self.plugins:
				self.mainLogger.info('getPlugins: executing  %s', plugin.__class__.__name__)

				try:
					output[plugin.__class__.__name__] = plugin.run()

				except Exception, ex:
					import traceback
					self.mainLogger.error('getPlugins: exception = %s', traceback.format_exc())

				self.mainLogger.debug('getPlugins: %s output: %s', plugin.__class__.__name__, output[plugin.__class__.__name__])
				self.mainLogger.info('getPlugins: executed %s', plugin.__class__.__name__)

			self.mainLogger.debug('getPlugins: returning')

			# Each plugin should output a dictionary so we can convert it to JSON later
			return output

		else:
			self.mainLogger.debug('getPlugins: no plugins, returning false')

			return False

	#
	# Postback
	#

	def doPostBack(self, postBackData):
		self.mainLogger.debug('doPostBack: start')

		try:
			self.mainLogger.info('doPostBack: attempting postback: %s', self.agentConfig['sdUrl'])

			# Build the request handler
			request = urllib2.Request(self.agentConfig['sdUrl'] + '/postback/', postBackData, headers)

			# Do the request, log any errors
			response = urllib2.urlopen(request)

			self.mainLogger.info('Postback response: %s', response.read())

		except urllib2.HTTPError, e:
			self.mainLogger.error('doPostBack: HTTPError = %s', e)
			return False

		except urllib2.URLError, e:
			self.mainLogger.error('doPostBack: URLError = %s', e)
			return False

		except httplib.HTTPException, e: # Added for case #26701
			self.mainLogger.error('doPostBack: HTTPException = %s', e)
			return False

		except Exception, e:
			import traceback
			self.mainLogger.error('doPostBack: Exception = %s', traceback.format_exc())
			return False

		finally:
			if int(pythonVersion[1]) >= 6:
				try:
					response.close()
				except Exception, e:
					import traceback
					self.mainLogger.error('doPostBack: Exception = %s', traceback.format_exc())
					return False
			
			self.mainLogger.debug('doPostBack: completed')

	def doChecks(self, sc, firstRun, systemStats=False):
		macV = None
		if sys.platform == 'darwin':
			macV = platform.mac_ver()

		if not self.topIndex: # We cache the line index from which to read from top
			# Output from top is slightly modified on OS X 10.6+ (case #28239)
			if macV and [int(v) for v in macV[0].split('.')] >= [10, 6, 0]:
				self.topIndex = 6
			else:
				self.topIndex = 5

		if not self.os:
			if macV:
				self.os = 'mac'
			elif sys.platform.find('freebsd') != -1:
				self.os = 'freebsd'
			else:
				self.os = 'linux'

		# We only need to set this if we're on FreeBSD
		if self.linuxProcFsLocation == None and self.os == 'freebsd':
			self.linuxProcFsLocation = self.getMountedLinuxProcFsLocation()
		else:
			self.linuxProcFsLocation = '/proc'

		self.mainLogger.debug('doChecks: start')

		# Do the checks
		apacheStatus = self.getApacheStatus()
		diskUsage = self.getDiskUsage()
		loadAvrgs = self.getLoadAvrgs()
		memory = self.getMemoryUsage()
		mysqlStatus = self.getMySQLStatus()
		networkTraffic = self.getNetworkTraffic()
		nginxStatus = self.getNginxStatus()
		processes = self.getProcesses()
		rabbitmq = self.getRabbitMQStatus()
		mongodb = self.getMongoDBStatus()
		couchdb = self.getCouchDBStatus()
		plugins = self.getPlugins()
		ioStats = self.getIOStats();
		cpuStats = self.getCPUStats();

		if processes is not False and len(processes) > 4194304:
			self.mainLogger.warn('doChecks: process list larger than 4MB limit, so it has been stripped')

			processes = []

		self.mainLogger.debug('doChecks: checks success, build payload')

		self.mainLogger.info('doChecks: agent key = %s', self.agentConfig['agentKey'])

		checksData = {}

		# Basic payload items
		checksData['os'] = self.os
		checksData['agentKey'] = self.agentConfig['agentKey']
		checksData['agentVersion'] = self.agentConfig['version']

		if diskUsage != False:

			checksData['diskUsage'] = diskUsage

		if loadAvrgs != False:

			checksData['loadAvrg'] = loadAvrgs['1']

		if memory != False:

			checksData['memPhysUsed'] = memory['physUsed']
			checksData['memPhysFree'] = memory['physFree']
			checksData['memSwapUsed'] = memory['swapUsed']
			checksData['memSwapFree'] = memory['swapFree']
			checksData['memCached'] = memory['cached']

		if networkTraffic != False:

			checksData['networkTraffic'] = networkTraffic

		if processes != False:

			checksData['processes'] = processes

		# Apache Status
		if apacheStatus != False:

			if 'reqPerSec' in apacheStatus:
				checksData['apacheReqPerSec'] = apacheStatus['reqPerSec']

			if 'busyWorkers' in apacheStatus:
				checksData['apacheBusyWorkers'] = apacheStatus['busyWorkers']

			if 'idleWorkers' in apacheStatus:
				checksData['apacheIdleWorkers'] = apacheStatus['idleWorkers']

			self.mainLogger.debug('doChecks: built optional payload apacheStatus')

		# MySQL Status
		if mysqlStatus != False:

			checksData['mysqlConnections'] = mysqlStatus['connections']
			checksData['mysqlCreatedTmpDiskTables'] = mysqlStatus['createdTmpDiskTables']
			checksData['mysqlMaxUsedConnections'] = mysqlStatus['maxUsedConnections']
			checksData['mysqlOpenFiles'] = mysqlStatus['openFiles']
			checksData['mysqlSlowQueries'] = mysqlStatus['slowQueries']
			checksData['mysqlTableLocksWaited'] = mysqlStatus['tableLocksWaited']
			checksData['mysqlThreadsConnected'] = mysqlStatus['threadsConnected']

			if mysqlStatus['secondsBehindMaster'] != None:
				checksData['mysqlSecondsBehindMaster'] = mysqlStatus['secondsBehindMaster']

		# Nginx Status
		if nginxStatus != False:
			checksData['nginxConnections'] = nginxStatus['connections']
			checksData['nginxReqPerSec'] = nginxStatus['reqPerSec']

		# RabbitMQ
		if rabbitmq != False:
			checksData['rabbitMQ'] = rabbitmq

		# MongoDB
		if mongodb != False:
			checksData['mongoDB'] = mongodb

		# CouchDB
		if couchdb != False:
			checksData['couchDB'] = couchdb

		# Plugins
		if plugins != False:
			checksData['plugins'] = plugins

		if ioStats != False:
			checksData['ioStats'] = ioStats

		if cpuStats != False:
			checksData['cpuStats'] = cpuStats

		# Include system stats on first postback
		if firstRun == True:
			checksData['systemStats'] = systemStats
			self.mainLogger.debug('doChecks: built optional payload systemStats')

		# Include server indentifiers
		import socket

		try:
			checksData['internalHostname'] = socket.gethostname()
			self.mainLogger.info('doChecks: hostname = %s', checksData['internalHostname'])

		except socket.error, e:
			self.mainLogger.debug('Unable to get hostname: %s', e)

		self.mainLogger.debug('doChecks: payload: %s' % checksData)
		self.mainLogger.debug('doChecks: payloads built, convert to json')

		# Post back the data
		if int(pythonVersion[1]) >= 6:
			self.mainLogger.debug('doChecks: json convert')
	
			try:
				payload = json.dumps(checksData, encoding='latin1').encode('utf-8')
			
			except Exception, e:
				import traceback
				self.mainLogger.error('doChecks: failed encoding payload to json. Exception = %s', traceback.format_exc())
				return False
		
		else:
			self.mainLogger.debug('doChecks: minjson convert')

			payload = minjson.write(checksData)

		self.mainLogger.debug('doChecks: json converted, hash')

		payloadHash = md5(payload).hexdigest()
		postBackData = urllib.urlencode({'payload' : payload, 'hash' : payloadHash})

		self.mainLogger.debug('doChecks: hashed, doPostBack')

		self.doPostBack(postBackData)

		self.mainLogger.debug('doChecks: posted back, reschedule')

		sc.enter(self.agentConfig['checkFreq'], 1, self.doChecks, (sc, False))

	def getMountedLinuxProcFsLocation(self):
		self.mainLogger.debug('getMountedLinuxProcFsLocation: attempting to fetch mounted partitions')

		# Lets check if the Linux like style procfs is mounted
		try:
			proc = subprocess.Popen(['mount'], stdout = subprocess.PIPE, close_fds = True)
			mountedPartitions = proc.communicate()[0]

			if int(pythonVersion[1]) >= 6:
				try:
					proc.kill()
				except Exception, e:
					self.mainLogger.debug('Process already terminated')

			location = re.search(r'linprocfs on (.*?) \(.*?\)', mountedPartitions)

		except OSError, e:
			self.mainLogger.error('getMountedLinuxProcFsLocation: OS error: %s', e)

		# Linux like procfs file system is not mounted so we return False, else we return mount point location
		if location == None:
			self.mainLogger.debug('getMountedLinuxProcFsLocation: none found so using /proc')
			return '/proc' # Can't find anything so we might as well try this

		location = location.group(1)

		self.mainLogger.debug('getMountedLinuxProcFsLocation: using %s', location)

		return location