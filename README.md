Nimo
=====

Nimo is a server monitoring tool. It periodically polls the system and posts 
stats on server performance to a server monitoring application, supported platforms: mac, linux and free-bsd

Install
=======

Nimo is a node js package. It only requires node to be installed with its package manager npm (which is included by default)

### 1. install node 

For debian follow the instructions here: https://github.com/joyent/node/wiki/Installing-Node.js-via-package-manager
Otherwise: http://nodejs.org/download/ 


### 2. On the server you wish to monitor, go to the directory you wish to install nimo then:

    git clone git://github.com/steve-obrien/nimo.git
    cd nimo
    npm install

### 3. Configure nimo for your device. 
To setup mysql moitoring you will have to put your mysql username and password details into the config file
inside the nimo directory:

    nano config/config.js 

### 4. Run nimo

    node nimo & // Note: Todo: this forks as a separate processes but does not run as a deamon process as it should.