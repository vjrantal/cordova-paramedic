#!/usr/bin/env node

var http = require('http'),
    nconf = require('nconf');
    shell = require('shelljs'),
    fs = require('fs'),
    request = require('request'),
    path = require('path');

var PORT = 8008;
var USAGE = 'Error missing args.\n'
USAGE += 'Usage: $cordova-paramedic --platform CORDOVA-PLATFORM --plugin PLUGIN-PATH\n';
USAGE += 'Optional configurations can be set with: --config path/to/config.json';
var storedCWD = process.cwd();
var TIMEOUT = 10 * 60 * 1000; // 10 minutes in msec - this will become a param

var plugin,platformId,tempProjectPath;

run();

// main program here
function run() {
    init();
    createTempProject();
    installPlugins();
    startServer();
}

function init() {
    nconf.argv();

    if(!nconf.get('platform') || !nconf.get('plugin')) {
        console.log(USAGE);
        process.exit(1);
    }

    platformId = nconf.get('platform');
    plugin = nconf.get('plugin');
    config = nconf.get('config');
    tempProjectPath = nconf.get('tempProjectPath') || 'tmp';

    if (config) {
        nconf.file({ file: config });
    }

    console.log('cordova-paramedic :: checking cordova version');
    var cordovaResult = shell.exec('cordova --version');
    if(cordovaResult.code) {
        console.error(cordovaResult.output);
        process.exit(cordovaResult.code);
    }
}

function createTempProject() {
    console.log('cordova-paramedic :: creating temp project');
    shell.exec('cordova create ' + tempProjectPath);
    shell.cd(tempProjectPath);
}

function installPlugins() {
    console.log('cordova-paramedic :: installing ' + plugin);

    var installExitCode = shell.exec('cordova plugin add ' + plugin).code;
    if(installExitCode != 0) {
        console.error('Failed to install plugin : ' + plugin);
        cleanUpAndExitWithCode(1);
        return;
    }

    console.log('cordova-paramedic :: installing ' + path.join(plugin,'tests'));
    installExitCode = shell.exec('cordova plugin add ' + path.join(plugin,'tests')).code;
    if(installExitCode != 0) {
        console.error('Failed to find /tests/ for plugin : ' + plugin);
        cleanUpAndExitWithCode(1);
        return;
    }

    console.log('cordova-paramedic :: installing plugin-test-framework');
    installExitCode = shell.exec('cordova plugin add https://github.com/vjrantal/cordova-plugin-test-framework').code;
    if(installExitCode != 0) {
        console.error('cordova-plugin-test-framework');
        cleanUpAndExitWithCode(1);
        return;
    }

}

function addAndRunPlatform() {
    setConfigStartPage();
    //console.log("cordova-paramedic :: adding platform and running");
    shell.exec('cordova platform add ' + platformId);
    shell.exec('cordova prepare');
    // limit runtime to 5 minutes
    setTimeout(function(){
        console.error("This test seems to be blocked :: timeout exceeded. Exiting ...");
        cleanUpAndExitWithCode(1);
    },(TIMEOUT));

    var cordovaOptions = platformId.split("@")[0];
    if(nconf.get('architecture')) {
        cordovaOptions += ' --archs=' + nconf.get('architecture');
    }
    if(nconf.get('device')) {
        cordovaOptions += ' --device';
    }
    if(nconf.get('phone')) {
        cordovaOptions += ' -- --phone';
    }

    var buildCommand = 'cordova build ' + cordovaOptions;
    console.log('cordova-paramedic :: trying to build using command: ' + buildCommand);
    shell.exec(buildCommand,
        {async:true},
        function(code,output){
          if(code != 0) {
              console.error("Error: cordova build return error code " + code);
              console.log("output: " + output);
              cleanUpAndExitWithCode(1);
          }
          // If buildOnly configuration was set to true, don't try to run
          // but exist with success code since build was successful
          if (nconf.get('buildOnly')) {
            cleanUpAndExitWithCode(0);
          }
          var runCommand = 'cordova run --no-build ' + cordovaOptions;
          console.log('cordova-paramedic :: trying to run using command: ' + runCommand);
          shell.exec(runCommand,
              {async:true},
              function(code,output){
                  if(code != 0) {
                      console.error("Error: cordova run return error code " + code);
                      console.log("output: " + output);
                      cleanUpAndExitWithCode(1);
                  }
              }
          );
        }
    );
}

function cleanUpAndExitWithCode(exitCode) {
    shell.cd(storedCWD);
    if(nconf.get('removeTempProject')) {
      shell.rm('-rf', tempProjectPath);
    }
    process.exit(exitCode);
}

function writeMedicLogUrl(url) {
    console.log("cordova-paramedic :: writing medic log url " + url + " to project");
    var obj = {logurl:url};
    fs.writeFileSync(path.join("www","medic.json"),JSON.stringify(obj));
}


function setConfigStartPage() {

    console.log("cordova-paramedic :: setting app start page to test page");

    var fileName = 'config.xml';
    var configStr = fs.readFileSync(fileName).toString();
    if(configStr) {
        configStr = configStr.replace("src=\"index.html\"","src=\"cdvtests/index.html\"");
        fs.writeFileSync(fileName, configStr);
    }
    else {
        console.error("Oops, could not find config.xml");
    }
}

function startServer() {

    console.log('cordova-paramedic :: starting local medic server for platform ' + platformId);

    request.get('http://google.com/', function(e, res, data) {
        if(e) {
            console.error('Failed to detect ip address');
            cleanUpAndExitWithCode(1);
        }
        else {
            var ip = res.req.connection.localAddress ||
                     res.req.socket.localAddress ||
                     '127.0.0.1';
            console.log('Detected ip address: ' + ip);
            var server = http.createServer(requestListener);
            server.listen(PORT, ip, function onServerConnect() {
                var resultServer = nconf.get('resultServer') || ip;
                writeMedicLogUrl('http://' + resultServer + ':' + PORT);
                addAndRunPlatform();
            });
        }
    });
}

function requestListener(request, response) {
    if (request.method == 'PUT' || request.method == 'POST') {
        var body = '';
        request.on('data', function (data) {
            body += data;
            // Too much POST data, kill the connection!
            if (body.length > 1e6) {
                req.connection.destroy();
            }
        });
        request.on('end', function (res) {
            if(body.indexOf("mobilespec")  == 2){ // {\"mobilespec\":{...}}
                try {
                    console.log("body = " + body);
                    var results = JSON.parse(body);
                    console.log("Results:: ran " +
                        results.mobilespec.specs +
                        " specs with " +
                        results.mobilespec.failures +
                        " failures");
                    if(results.mobilespec.failures > 0) {
                        cleanUpAndExitWithCode(1);
                    }
                    else {
                        cleanUpAndExitWithCode(0);
                    }

                }
                catch(err) {
                    console.log("parse error :: " + err);
                    cleanUpAndExitWithCode(1);
                }
            }
            else {
                console.log("console-log:" + body);
            }
        });
    }
    else {
        console.log(request.method);
        response.writeHead(200, { 'Content-Type': 'text/plain'});
        response.write("Hello"); // sanity check to make sure server is running
        response.end();
    }
}
