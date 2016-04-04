/* eslint-disable indent*/

/**
 * Returns a function adapted from Browerify's _createDeps method:
 * https://github.com/substack/node-browserify/blob/f9c256174fe282f7a8ca619d7168161e8e208524/index.js#L419-L565
 *
 * Synchronously configures and returns an instance of module-deps-diskless (a fork of module-deps that you can provide with a custom readFile method upon instantiation).
 */

import _ from 'lodash';
import browserResolveNoio from 'browser-resolve-noio';
import builtins from 'browserify/lib/builtins';
import defined from 'defined';
import has from 'has';
import insertGlobals from 'insert-module-globals';
import mdeps from 'module-deps-diskless';
import path from 'path';
import xtend from 'xtend';
import subdir from 'subdir';
import fs from 'graceful-fs';

module.exports = function getCreateDeps(src, include) {
    const readFile = (filePath, encoding, callback) => {
        console.assert(path.isAbsolute(filePath));

        // fix arguments
        if (_.isFunction(encoding)) {
            callback = encoding;
            encoding = null;
        }

        // console.log('browserify readFile', filePath, encoding);

        if (subdir(src, filePath)) {
            const contents = include(path.relative(src, filePath));

            if (contents) {
              callback(null, encoding ? contents.toString(encoding) : contents
              );
            }
            else {
                const error = new Error(`Not found: ${filePath}`);
                error.code = 'ENOENT';
                callback(error);
            }
        }
        else fs.readFile(filePath, callback);
    };

    const isFile = (filePath, callback) => {
        // console.log('browserify isFile', filePath);

        if (subdir(src, filePath)) {
            const contents = include(path.relative(src, filePath));

            if (contents) callback(null, true);
            else callback(null, false);
        }
        else {
            fs.stat(filePath, (error, stat) => {
                if (error && error.code !== 'ENOENT' && error.code === 'EISDIR') {
                    callback(error);
                    return;
                }

                callback(null, Boolean(stat && stat.isFile()));
            });
        }
    };


    return function createDeps(opts) {
        /*eslint-disable*/
        var self = this;

        var mopts = xtend(opts);

        var basedir = defined(opts.basedir, process.cwd());

        // Let mdeps populate these values since it will be resolving file paths
        // anyway.
        mopts.expose = this._expose;
        mopts.extensions = [ '.js', '.json' ].concat(mopts.extensions || []);
        self._extensions = mopts.extensions;

        mopts.transform = [];

        mopts.transformKey = [ 'browserify', 'transform' ];

        mopts.postFilter = function (id, file, pkg) {
            if (opts.postFilter && !opts.postFilter(id, file, pkg)) return false;
            if (self._external.indexOf(file) >= 0) return false;
            if (self._exclude.indexOf(file) >= 0) return false;

            // filter transforms on module dependencies
            if (pkg && pkg.browserify && pkg.browserify.transform) {
                // In edge cases it may be a string
                pkg.browserify.transform = [].concat(pkg.browserify.transform)
                        .filter(Boolean)
                        .filter(self._filterTransform);
            }
            return true;
        };

        mopts.filter = function (id) {
            if (opts.filter && !opts.filter(id)) return false;
            if (self._external.indexOf(id) >= 0) return false;
            if (self._exclude.indexOf(id) >= 0) return false;
            if (opts.bundleExternal === false && isExternalModule(id)) {
                return false;
            }
            return true;
        };

        mopts.resolve = function (id, parent, cb) {
            if (self._ignore.indexOf(id) >= 0) return cb(null, paths.empty, {});

            const browserResolveOptions = xtend(parent, {
                isFile,
                readFile,
            });

            // use customised fork of browser-resolve
            browserResolveNoio(id, browserResolveOptions, function (err, file, pkg) {
                if (file && self._ignore.indexOf(file) >= 0) {
                    return cb(null, paths.empty, {});
                }
                if (file && self._ignore.length) {
                    var nm = file.split('/node_modules/')[1];
                    if (nm) {
                        nm = nm.split('/')[0];
                        if (self._ignore.indexOf(nm) >= 0) {
                            return cb(null, paths.empty, {});
                        }
                    }
                }

                if (file) {
                    var ex = '/' + path.relative(basedir, file);
                    if (self._external.indexOf(ex) >= 0) {
                        return cb(null, ex);
                    }
                    if (self._exclude.indexOf(ex) >= 0) {
                        return cb(null, ex);
                    }
                    if (self._ignore.indexOf(ex) >= 0) {
                        return cb(null, paths.empty, {});
                    }
                }
                cb(err, file, pkg);
            });
        };

        if (opts.builtins === false) {
            mopts.modules = {};
            self._exclude.push.apply(self._exclude, Object.keys(builtins));
        }
        else if (opts.builtins && isarray(opts.builtins)) {
            mopts.modules = {};
            opts.builtins.forEach(function (key) {
                mopts.modules[key] = builtins[key];
            });
        }
        else if (opts.builtins && typeof opts.builtins === 'object') {
            mopts.modules = opts.builtins;
        }
        else mopts.modules = xtend(builtins);

        Object.keys(builtins).forEach(function (key) {
            if (!has(mopts.modules, key)) self._exclude.push(key);
        });

        mopts.globalTransform = [];
        if (!this._bundled) {
            this.once('bundle', function () {
                self.pipeline.write({
                    transform: globalTr,
                    global: true,
                    options: {}
                });
            });
        }

        var no = [].concat(opts.noParse).filter(Boolean);
        var absno = no.filter(function(x) {
            return typeof x === 'string';
        }).map(function (x) {
            return path.resolve(basedir, x);
        });

        function globalTr (file) {
            if (opts.detectGlobals === false) return through();

            if (opts.noParse === true) return through();
            if (no.indexOf(file) >= 0) return through();
            if (absno.indexOf(file) >= 0) return through();

            var parts = file.split('/node_modules/');
            for (var i = 0; i < no.length; i++) {
                if (typeof no[i] === 'function' && no[i](file)) {
                    return through();
                }
                else if (no[i] === parts[parts.length-1].split('/')[0]) {
                    return through();
                }
                else if (no[i] === parts[parts.length-1]) {
                    return through();
                }
            }

            var vars = xtend({
                process: function () { return "require('_process')" },
            }, opts.insertGlobalVars);

            if (opts.bundleExternal === false) {
                delete vars.process;
                delete vars.buffer;
            }

            return insertGlobals(file, xtend(opts, {
                debug: opts.debug,
                always: opts.insertGlobals,
                basedir: opts.commondir === false
                    ? '/'
                    : opts.basedir || process.cwd()
                ,
                vars: vars
            }));
        }


        mopts.readFile = readFile;

        return mdeps(mopts);
    };
};
