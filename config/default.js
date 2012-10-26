var configDefault = {
	// the device name, the human readable name of this device or server
	device: '', 
	// ?? key ?? your api key to identify you as a cutomer... todo
	key : '???', 
	// url to the monitoring service
	url : 'http://hub.newicon.net/hosting/server/monitor',
	// The polling frequency in seconds
	pollFreq : 60, 
	// mysql settings
	"mysql" : {
		"monitor":false,
		"host":'localhost',
		"user":'?',
		"password":'',
		// whether to log mysql slave status true | false only necessary if you have 
		// slave database configured
		"slave":false 
	},
	"apache" : {
		"statusUrl" : 'http://127.0.0.1/server-status?auto' // the apache server status url
	},
	// Mongo Db logging!
	"mongodb" : {
		"server" : '' 
	},
	// logging level, options: 'debug' or 'normal'
	"logging" : "nomal" 
};

module.exports = configDefault;