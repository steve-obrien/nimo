var config={mysql:{},apache:{},mongodb:{}};


// the device name, the human readable name of this device or server
config.device = '';
// ?? key ?? your api key to identify you as a cutomer... todo
config.key = '???';
// url to the monitoring service
config.url = 'http://127.0.0.1/nii/public/htdocs/hosting/server/monitor';
// The polling frequency in seconds
config.pollFreq = 5; 
 

// mysql settings
config.mysql.host = 'localhost';
config.mysql.user = 'root';
config.mysql.password = '';
// whether to log mysql slave status true | false
config.mysql.slave = true;


// the apache server status url
config.apache.statusUrl = 'http://127.0.0.1/server-status?auto';

// Mongo Db logging!
config.mongodb.server = '';

// logging level, options: 'debug' or 'normal'
config.logging = 'default';

module.exports = config;