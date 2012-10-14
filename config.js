var config = {}; config.mysql = {}; config.apache = {};

// the device name, the human readable name of this device or server
config.nimon.device = '';
// ?? key ?? your api key to identify you as a cutomer... todo
config.nimon.key = '???';
// url to the monitoring service
config.nimon.url = 'http://127.0.0.1/nii/public/htdocs/hosting/server/monitor';
// The polling frequency in seconds
config.nimon.pollFreq = 60; 
 
// mysql settings
config.mysql.host = 'localhost';
config.mysql.user = 'root';
config.mysql.password = '';
// whether to log mysql slave status true | false
config.mysql.slave = true;
// the apache server status url
config.apache.statusUrl = 'http://127.0.0.1/server-status?auto';

// logging level, options: 'debug' or 'normal'
config.logging = 'default';

module.exports = config;