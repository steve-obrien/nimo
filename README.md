Nimon
=====

Nimon the deamon! Nimon is a server monitoring tool. It periodically polls the system and posts 
stats on server performance to a server monitoring application

Install
=======

### 1. install node http://nodejs.org/download/

Taken from the docs:
For Debian Squeeze, your best bet is to compile node by yourself (as root):

    apt-get install python g++ make
    mkdir ~/nodejs && cd $_
    wget -N http://nodejs.org/dist/node-latest.tar.gz
    tar xzvf node-latest.tar.gz && cd `ls -rd node-v*`
    ./configure
    make install

### 2. On the server you wish to monitor, go to the directory you wish to install nimon then:

    git clone git@git.newicon.net:nimon
    cd nimon
    npm install

### 3. Configure nimon for your device. 
To setup mysql moitoring you will have to put your mysql username and password details into the config file
inside the nimon directory:

    nano config/config.js 

### 4. Run nimon

    node nimon & // Note: Todo: this forks as a separate processes but does not run as a deamon process as it should.

