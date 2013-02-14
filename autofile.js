/*jshint es5:true*/

'use strict';

var https = require('https');
var async = require('async');
var fs    = require('fs');

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

    filter: function (opt, ctx, next) {
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
                            ctx.log.debugln('Response ready');
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
                var dependedUpon = function (name, callback) {

                    // https://registry.npmjs.org/-/_view/dependedUpon?startkey=[%22optimist%22]&endkey=[%22optimist%22,%20{}]&group_level=3

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
                            ctx.log.debugln(name, 'ready!');

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
                //for (var i = packages.length - 1; i >= 0; i--) {
                for (var i = 10; i >= 0; i--) {
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
            description: 'Save aggregate file',
            
            task: function (opt, ctx, next) {


                var registry          = require(opt.curatedFile);
                registry.timestamp    = (new Date()).getTime();
                registry.dependedUpon = opt.dependedUpon;


                fs.writeFile(opt.registryFile, JSON.stringify(registry), function (err) {
                    if (err) {
                        return next('Could not store registry file: ' + err);
                    }

                    ctx.log.debugln('Wrote cache file:', opt.registryFile);

                    next();
                });
            }
        }
    ]
};

module.exports = task;