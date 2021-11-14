'use strict';

const port = process.env.PORT || 1337;

const http = require('http');
const path = require('path');
const express = require('express');

const server = express();
server.use(express.static(path.join(__dirname, '')));
server.use(express.json());

// creating an link to the probability engine
const engine = require('./ProbabilityEngine');


// used to send the actions and their consequences
server.post('/solve', function (req, res) {

	console.log('Data request received ');

	const message = req.body;

	//console.log("<== " + JSON.stringify(message));

	const reply = engine.calculate(message);

	if (reply == null) {
		console.log("No reply returned from probability engine");
	}

	//console.log("==> " + JSON.stringify(reply));

	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.write(JSON.stringify(reply));
	res.end();

});

// start up the server
http.createServer(server).listen(port, function () {
	console.log('HTTP server listening on port ' + port);
});

// a main site then send the html home page
server.get('/', function (req, res) {

	console.log("New client attaching");

	console.log('Sending web page from ' + path.join(__dirname, 'client.html'));

	res.sendFile(path.join(__dirname, 'client.html'));

});


