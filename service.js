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
    setTimeout(update, 5 * 60000);
};

update();