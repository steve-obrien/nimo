/* 
 * To change this template, choose Tools | Templates
 * and open the template in the editor.
 */
var agent = require('../lib/agent');
var _ = require('underscore');
var forever = require('forever');
var program = require('commander');
var config = require('../config/config.js');
var conf = require('../config/conf.json');
var colors = require('colors');
var pkg = require('../package.json');
var fs = require('fs');

/**
 * Store the script name to run
 */
var script = '../nimo.js';

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
						program.confirm('Monito mysql slave db? ', function(ok){

							conf.mysql.slave = ok;

							fs.writeFile('../config/conf.json', JSON.stringify(conf, null, 2), function (err) {
								if (err) throw err;
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

function findingNimo(callback) {
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

program
  .version(pkg.version)
  .usage('[command|options]');

program
	.command('test')
	.description('Run a test system scan and display the data package that would be posted')
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
	.command('start')
	.description('start Nimo deamon process')
	.action(function(){
		
		findingNimo(function(found){
			if (found) {
				console.log('Nimo is already running.');
			} else {
				forever.startDaemon(script);
				console.log('Nimo is running. Relax and whatch those stats! For extra info run "nimo show"');
			}
		});
		
	 });

program
	.command('stop')
	.description('Stop the Nimo deamon')
	.action(function(){
		
		findingNimo(function(found){
			if (found) {
				forever.stop(script);
			} else {
				console.log('Nimo is not currently running.');
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

program
	.command('config')
	.description('Show the current configuration settings for Nimo')
	.action(function(){
		console.log('Nimo:'.bold);
		console.log('    url      : '.grey + config.url)
		console.log('MySQL Settings:'.bold);
		console.log('    host     : '.grey + config.mysql.host)
		console.log('    user     : '.grey + config.mysql.user)
		console.log('    password : '.grey + config.mysql.password)
		console.log('    slave    : '.grey + config.mysql.slave)
	});
	
program
	.command('*')
	.action(function(){
		console.log('What? Try "'+'nimo --help'.cyan+'" to get a list of supported commands and options.')
	 });

program.parse(process.argv);