Nimon can parse the Apache mod_status output this shows:

 - current requests per second, 
 - idle and busy workers. 
 
May require additional configuration of the Apache server.

## 1) Configuring Apache

mod_status module
You first need to ensure the mod_status module is installed. This is usually compiled in by default but you may need to uncomment a line in your httpd.conf file: 

    #LoadModule status_module modules/mod_status.so
Removing the # will uncomment the line and enable mod_status.

Ubuntu
On packaged Ubuntu Apache installations you can enable the mod_status module by using the a2enmod command:

    sudo a2enmod status
    
## 2) mod_status configuration

Adding the following line to your httpd.conf file will enable the mod_status output. 

    ExtendedStatus On

If you restart Apache after adding this line and get an error, check that mod_status has been installed correctly. Look in your Apache error_log for details.

You then need to add in the following lines to set up the location from which the status output can be parsed by the agent: 

    <Location /server-status>
    SetHandler server-status
    Order Deny,Allow
    Deny from all
    Allow from 127.0.0.1 PUBLICIP
    </Location>
    
This will allow the status output to be accessed from http://localhost/server-status (localhost only works on the server itself - replace localhost with your server IP and it will be accessible externally to the IPs you specify in the Allow list, see below).

You should replace PUBLICIP with your server's public IP address. This means you will have 2 IPs listed (127.0.0.1 and your public IP). This is so the status output can only be accessed from the server itself. If you wish to access it from your browser, you need to add your IP address in (separated by a space). For example

    Allow from 127.0.0.1 127.0.0.2 127.0.0.3
    
You will now need to restart your Apache web server to allow the changes to take effect. 

## 3) Agent configuration

    apache_status_url: http://127.0.0.1/server-status?auto

Problems with server-status not being found
If you get a 404 error or a different page loads when you access the server status, you may have some .htaccess rewrite rules that are preventing Apache from handling the request. You can use this rewrite conditional to ensure requests get processed correctly. This goes above the rewrite rule that is catching the request to server-status 

    RewriteCond %{REQUEST_URI} !=/server-status