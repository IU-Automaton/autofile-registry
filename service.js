'use strict';

var automaton = require('automaton').create({
    debug: false
});

var update = function () {
    automaton
        .run(require('./autofile'), {}, scheduleUpdate)
        .pipe(process.stdout);
};

var scheduleUpdate = function () {
    process.nextTick(update);
};

update();