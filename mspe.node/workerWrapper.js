"use strict";

const workerpool = require('workerpool');

// create a worker and register public functions
workerpool.worker({
    calculate: calculate
});

const solver = require('./ProbabilityEngine');

// this is a wrapper so the solver can run on a workerpool but also keep the
// core modules free from workerpool requirements
function calculate(message) {
    return solver.calculate(message);
}
