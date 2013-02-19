/*jshint es5:true*/

'use strict';

var https  = require('https');
var async  = require('async');
var fs     = require('fs');
var equals = require('equals');

function getKeywordSearchPath(keyword) {
    return '/-/_view/byKeyword?startkey=["' + keyword + '"]&endkey=["' + keyword + '",{}]&group_level=3';
}

function getDependedUponPath(id) {
    return '/-/_view/dependedUpon?startkey=["' + id + '"]&endkey=["' + id + '",{}]';
}

function inspect(x, depth) {
    return require('util').inspect(x, false, depth || 10, true);
}

var task = {
    id: 'registry-handler',
    author: 'Indigo United',
    name: 'Automaton registry handler',

    options: {
        keyword: {
            description: 'The keyword that should be used to perform the ' +
                         'filter on NPM',
            'default': ['autofile', 'gruntplugin']
        }
    },

    setup: function (opt, ctx, next) {
        opt.curatedFile  = __dirname + '/db/curated.json',
        opt.registryFile = __dirname + '/db/registry.json';

        next();
    },

    tasks: [
        {
            description: 'Fetch information from NPM registry',

            task: function (opt, ctx, next) {
                // create function that fetches all the packages with a specific
                // keyword
                var fetchKeywordPackages = function (keyword, callback) {
                    var registryUrl = 'https://registry.npmjs.org' + getKeywordSearchPath(keyword);
                    ctx.log.debugln('Going to fetch data from', registryUrl);
                    var req = https.get(registryUrl, function (res) {
                        if (res.statusCode !== 200) {
                            return callback(new Error('Unexpected HTTP status code while fetching data from NPM registry: ' + res.statusCode));
                        }

                        ctx.log.debugln('Starting response');
                        var data = '';

                        res.on('data', function (chunk) {
                            ctx.log.debug('.');
                            data += chunk;
                        });

                        res.on('end', function () {
                            ctx.log.successln('Fetched packages for keyword', keyword);
                            data = JSON.parse(data);

                            callback(null, data);
                        });
                    });

                    req.on('error', function (err) {
                        return callback(new Error('Error fetching data from NPM registry: ' + err));
                    });
                };

                // create batch for fetching the info from NPM
                var batch = {};
                opt.keyword.forEach(function (keyword) {
                    batch[keyword] = fetchKeywordPackages.bind(this, keyword);
                });

                // run batch
                async.parallel(batch, function (err, result) {
                    if (err) {
                        return next(new Error('Error fetching keyword packages from registry: ' + err));
                    }

                    var packages = {};

                    for (var k in result) {
                        result[k].rows.forEach(function (row) {
                            packages[row.key[1]] = null;
                        });
                    }

                    opt.packages = [];
                    for (k in packages) {
                        opt.packages.push(k);
                    }

                    next();
                });
            }
        },
        {
            decription: 'Fetch individual task info from NPM registry',

            task: function (opt, ctx, next) {
                var total   = opt.packages.length,
                    fetched = 0;

                var dependedUpon = function (name, callback) {

                    var registryUrl = 'https://registry.npmjs.org' + getDependedUponPath(name);

                    var req = https.get(registryUrl, function (res) {
                        if (res.statusCode !== 200) {
                            return callback(new Error('Unexpected HTTP status code while fetching data from NPM registry: ' + res.statusCode));
                        }

                        var data = '';

                        res.on('data', function (chunk) {
                            data += chunk;
                        });

                        res.on('end', function () {
                            ++fetched;

                            ctx.log.successln('(', fetched, '/', total, ')', 'Fetched depend info for task', name);


                            data = JSON.parse(data);

                            callback(null, data.rows[0] ? data.rows[0].value : 0);
                        });
                    });

                    req.on('error', function (err) {
                        return callback(new Error('Error fetching data from NPM registry: ' + err));
                    });

                };

                var batch = {};
                var packages  = opt.packages;
                // TODO: remove hack below
                for (var i = packages.length - 1; i >= 0; i--) {
                //for (var i = 10; i >= 0; i--) {
                    var name = packages[i];

                    batch[name] = dependedUpon.bind(this, name);
                }

                ctx.log.debugln('Going to process', packages.length, 'requests');

                async.parallelLimit(batch, 500, function (err, result) {
                    if (err) {
                        return next(new Error('Error fetching dependedUpon: ' + err));
                    }

                    opt.dependedUpon = result;

                    next();
                    console.log(inspect(result));
                });
            }
        },
        {
            description: 'Check if anything in the registry changed',

            task: function (opt, ctx, next) {
                fs.exists(opt.registryFile, function (exists) {
                    if (!exists) {
                        opt['update-registry'] = true;

                        return next();
                    }

                    var oldRegistry;

                    // build new registry and load previous registry
                    async.parallel([
                        function (cb) {
                            // read previous registry
                            fs.readFile(opt.registryFile, function (err, data) {
                                if (err) {
                                    return cb(err);
                                }

                                oldRegistry = JSON.parse(data);
                                delete oldRegistry.timestamp;

                                cb();
                            });
                        },
                        function (cb) {
                            // create new registry
                            fs.readFile(opt.curatedFile, function (err, data) {
                                if (err) {
                                    return cb(err);
                                }

                                opt.newRegistry              = JSON.parse(data);
                                opt.newRegistry.dependedUpon = opt.dependedUpon;

                                cb();
                            });

                        }
                    ], function (err) {
                        if (err) {
                            return next(err);
                        }

                        // if registry changed, mark it for update
                        if (!equals.object(oldRegistry, opt.newRegistry)) {
                            opt['update-registry'] = true;
                        }

                        ctx.log.infoln(opt['update-registry'] ? 'Changes detected, updating registry' : 'Registry is unchanged.');

                        next();
                    });
                });
            }
        },
        {
            description: 'Save aggregate file',
            on: '{{update-registry}}',

            task: function (opt, ctx, next) {
                opt.newRegistry.timestamp = (new Date()).toString();

                fs.writeFile(opt.registryFile, JSON.stringify(opt.newRegistry), function (err) {
                    if (err) {
                        return next('Could not store registry file: ' + err);
                    }

                    ctx.log.debugln('Wrote cache file:', opt.registryFile);

                    next();
                });
            }
        },
        {
            task: 'run',
            on: '{{update-registry}}',
            description: 'Add new registry file',
            options: {
                cmd: 'git add ./db/registry.json'
            }
        },
        {
            task: 'run',
            on: '{{update-registry}}',
            description: 'Commit new registry file',
            options: {
                cmd: 'git commit -m "Update registry - ' + (new Date()).toString() + '"'
            }
        },
        {
            task: 'run',
            on: '{{update-registry}}',
            description: 'Pull changes from Github',
            options: {
                cmd: 'git pull origin master'
            }
        },
        {
            task: 'run',
            on: '{{update-registry}}',
            description: 'Push changes into Github',
            options: {
                cmd: 'git push origin master'
            }
        }
    ]
};

module.exports = task;
