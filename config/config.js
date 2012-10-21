var config={mysql:{},apache:{},mongodb:{}};


// the device name, the human readable name of this device or server
config.device = '';
// ?? key ?? your api key to identify you as a cutomer... todo
config.key = '???';
// url to the monitoring service
config.url = 'http://hub.newicon.net/hosting/server/monitor';
// The polling frequency in seconds
config.pollFreq = 60; 
 

// mysql settings
config.mysql.monitor = false;
config.mysql.host = 'localhost';
config.mysql.user = '?';
config.mysql.password = '';
// whether to log mysql slave status true | false only necessary if you have 
// slave database configured
config.mysql.slave = false;


// the apache server status url
config.apache.statusUrl = 'http://127.0.0.1/server-status?auto';

// Mongo Db logging!
config.mongodb.server = '';

// logging level, options: 'debug' or 'normal'
config.logging = 'normal';

module.exports = config;