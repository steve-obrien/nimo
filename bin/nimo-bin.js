/* 
 * To change this template, choose Tools | Templates
 * and open the template in the editor.
 */
var agent = require('../lib/agent');
var _ = require('underscore');
var forever = require('forever');
var program = require('commander');
var colors = require('colors');
var pkg = require('../package.json');
var fs = require('fs');

var config = _.extend(require('../config/default.js'), require('../config/config.json'));

/**
 * Store the script name to run
 */
var script = __dirname + '/../nimo.js';

function configure() {
	program.confirm('Would you like to configure Nimo now? ', function(ok){
		if (!ok)
			 process.stdin.destroy();

		 if (conf === undefined)
				var conf = {mysql:{}};

		// mysql config
		program.confirm('Monitor Mysql? ', function(mysqlMonitor) {
			conf.mysql.monitor = mysqlMonitor;
			program.prompt('Enter Mysql host: ', function(mysqlHost){
				conf.mysql.host = mysqlHost;
				program.prompt('Enter Mysql user: ', function(mysqlUser){
					conf.mysql.user = mysqlUser;
					program.prompt('Enter Mysql password: ', function(mysqlPassword){
						conf.mysql.password = mysqlPassword || '';
						program.confirm('Monitor mysql slave db? ', function(ok){

							conf.mysql.slave = ok;

							fs.writeFile(__dirname+'/../config/config.json', JSON.stringify(conf, null, 2), function (err) {
								if (err) throw err;
								config = _.extend(config, conf);
								console.log('It\'s saved!');
							});

							process.stdin.destroy();

						});
					});
				});
			});
		});
	});
}
// Ha ha very funny...
function findingNimo (callback) {
	forever.list(false,  function(n, data){
		if (data === null) {
			callback(false);
		} else {
			var found = _.find(data, function (s) {
				return (s.file == script);
			});
			callback(found);
		}
	})
}

function start () {
	findingNimo(function(found){
		if (found) {
			console.log('Nimo is already running.');
		} else {
			forever.startDaemon(script);
			console.log('Nimo started. ' + 'Relax and whatch those stats! For extra info run "nimo show"'.cyan);
		}
	});
}

function configShow(){
	console.log('Nimo Core:'.bold);
	console.log('  url  '.cyan + ' : '.grey + config.url)

	console.log('MySQL Settings:'.bold);
	if (config.mysql.monitor) {
		console.log('  mysql.monitor  '.cyan + ' : '.grey + config.mysql.monitor)
		console.log('  mysql.host     '.cyan + ' : '.grey + config.mysql.host)
		console.log('  mysql.user     '.cyan + ' : '.grey + config.mysql.user)
		console.log('  mysql.password '.cyan + ' : '.grey + config.mysql.password)
		console.log('  mysql.slave    '.cyan + ' : '.grey + config.mysql.slave)
	} else {
		console.log('  mysql.monitor  '.cyan + ' : '.grey + config.mysql.monitor)
	}
}

program
  .version(pkg.version)
  .usage('[command|options]');

program
	.command('test')
	.description('Run a test system scan and display the data pack\n\
	age that would be posted')
	.action(function(){
		agent.doChecks(function(err, data){
			console.log(data);
			console.log('test complete'.green);
		});
	});
	
program
	.command('configure')
	.description('Configure Nimo, set up what needs monitoring, db logins etc. (experimental not working)')
	.action(function(){
		configure();
	});
	
program
	.command('config')
	.description('Show the current configuration settings for Nimo')
	.action(function(){
		configShow();
	});

program
	.command('start')
	.description('start Nimo deamon process')
	.action(function(){
		start();
	 });

program
	.command('stop')
	.description('Stop the Nimo deamon')
	.action(function(){
		findingNimo(function(found){
			if (found) {
				forever.stop(script).on('stop',  function(){console.log('Nimo stopped.');});
			} else {
				console.log('Nimo is not currently running.');
			}
		})
	});
	
program
	.command('restart')
	.description('Restart the Nimo deamon')
	.action(function(){
		
		findingNimo(function(found){
			if (found) {
				forever.stop(script).on('stop', function(){
					console.log('Nimo stopped.');
					setTimeout(function(){console.log('Starting...'.cyan)}, 500);
					setTimeout(start, 1000);
				});
			} else {
				console.log('Nimo is not currently running. Starting...');
				start();
			}
		})
		
	});
	
program
	.command('show')
	.description('Show Nimo process status')
	.action(function(){
		forever.list(true,  function(n, data){
			if (data === null) {
				console.log('Nimo is not currently running');
			} else {
				console.log(data);
			}
		})
	});
	
config.get = function(path) {
	var tokens = path.split('.'), val = this[tokens[0]];
	if (tokens.length < 2) return val;
	for(var i = 1; i < tokens.length; i++) {
	   val = val[tokens[i]];
	}
	return val;
};

config.set = function(path, value) {
	var obj = this;
	tokens = path.split('.');
	if (tokens.length < 2) {
		if (_.isUndefined(obj[tokens])) return false;
		return obj[tokens] = value;
	}
	for (var i = 0, len = tokens.length; i < len - 1; i++) {
		if (_.isUndefined(obj[tokens[i]])) return false;
		obj = obj[tokens[i]];
	}
	if (_.isUndefined(obj[tokens[i]])) return false;
	return obj[tokens[i]] = value;
};
	
program
	.command('setconfig <option> <value>')
	.description('Set a config option e.g: mysql.host localhost')
	.action(function(option, value){
		//console.log(config)
		// set conf to current config options
		if (!config.set(option, value)){
			console.log('Incorrect config option');
			return false;
		}
		
		fs.writeFile(__dirname+'/../config/config.json', JSON.stringify(config, null, 2), function (err) {
			if (err) throw err;
			console.log('Config updated!'.bold.green);
		});
		
		configShow();
		
program
	.command('post')
	.description('Force an imediate system scan and post the result')
	.action(function(){
		agent.doChecks(function(err, data){
			console.log(data);
			console.log('test complete'.green);
			console.log('Post results for device: '+data.system.device);
			agent.post(data);
		});
	});

program
	.command('*')
	.action(function(){
		console.log('What? Try "'+'nimo --help'.cyan+'" to get a list of supported commands and options.')
	 });

program.parse(process.argv);