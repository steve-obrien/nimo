var mysql = require('mysql');
var postmark = require('postmark')('15fa02db-fa13-47cc-853b-e4489f4fb18b');
var _ = require('underscore');
var config = require('config');

var dbConfig = {
  host     : config.db.host,
  user     : config.db.user,
  password : config.db.password
};

var dbTable = config.db.name + '.' + config.db.ping_table;

var agent = require('./lib/agent');
agent.run();