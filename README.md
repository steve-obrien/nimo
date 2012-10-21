Nimo
=====

Nimo the Deamon! Nimo is a server monitoring tool. It periodically polls the system and posts 
stats on server performance to a server monitoring application

Install
=======

Nimo is a node js package. It only requires node to be installed with its package manager npm (which is included by default)

### 1. install node 

For debian follow the instructions here: https://github.com/joyent/node/wiki/Installing-Node.js-via-package-manager
Otherwise: http://nodejs.org/download/ 

Directly from the docs:

    apt-get install python g++ make
    mkdir ~/nodejs && cd $_
    wget -N http://nodejs.org/dist/node-latest.tar.gz
    tar xzvf node-latest.tar.gz && cd `ls -rd node-v*`
    ./configure
    make install


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



Alternatively you can install the forever node package. 

    sudo npm install forever -g

This installs forever globally, we can then run nimo as a deamon by running this command

    forever start ./nimo.js


## Install - cli

Install Nimo globally

    npm install nimo -g

Then:
    
    nimo --help

    nimo start