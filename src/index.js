// import convertSourceMap from 'convert-source-map';
import _ from 'lodash';
import getCreateDeps from './getCreateDeps';
import path from 'path';
import { cache, matcher } from 'exhibit';
import { createReadStream } from 'streamifier';
import { promisify } from 'bluebird';

const defaults = {
	match: '**/*.js',
	entries: '**/*.entry.js',
	cwd: process.cwd(),
	transforms: [],
	sourceMap: true,
};

export default function () {
	let options;

	// handle varying numbers of arguments
	switch (arguments.length) {
	case 0:
		options = _.assign({}, defaults);
		break;
	case 1: {
		const arg = arguments[0];
		if (_.isFunction(arg) || _.isString(arg) || _.isArray(arg)) {
			options = _.assign({}, defaults, { entries: arg });
		}
		else options = _.assign({}, defaults, arg);
		break;
	}
	case 2:
		options = _.assign({}, defaults, arguments[1], { entries: arguments[0] });
		break;
	default:
		throw new TypeError('Invalid options');
	}

	// check for alias option names
	if (options.entry) {
		options.entries = options.entry;
		delete options.entry;
	}
	if (options.extension) {
		options.extensions = options.extension;
		delete options.extension;
	}
	if (options.transform) {
		options.transforms = options.transform;
		delete options.transform;
	}

	// validate and normalize the extensions (make sure they've all got a dot)
	if (options.extensions) {
		if (_.isString(options.extensions)) options.extensions = [options.extensions];

		options.extensions.forEach((item, i) => {
			if (!_.isString(item)) {
				throw new TypeError('options.extensions should be an array of strings, or a single string');
			}

			if (item.length && item.charAt(0) !== '.') options.extensions[i] = '.' + item;
		});
	}

	if (options.transforms && !Array.isArray(options.transforms)) {
		options.transforms = [options.transforms];
	}

	// make a set of all extensions (including the standard two)
	const allExtensions = new Set(['.js', '.json']);
	if (options.extensions) {
		for (const extension of options.extensions) allExtensions.add(extension);
	}

	// create the options that will be used to instantiate every Browserify instance
	const browserifyOptions = {
		extensions: options.extensions,
		basedir: options.cwd, // or should this be the source dir?
		debug: options.sourceMap,
		fullPaths: false,
		paths: [path.join(options.cwd, 'node_modules')],
		transform: options.transforms,
	};

	// remove browserify from the global cache because we're going to monkey-patch it
	const browserifyPath = require.resolve('browserify');
	const oldBrowserify = require.cache[browserifyPath];
	delete require.cache[browserifyPath];

	// load browserify
	const Browserify = require('browserify'); // eslint-disable-line global-require
	require.cache[browserifyPath] = oldBrowserify;

	// delete it from the global cache because we're going to monkey-patch it
	delete require.cache[require.resolve('browserify')];

	// prepare matchers
	const match = matcher(options.match);
	const matchEntry = matcher(options.entries);

	// ideally user will have set root to the 'src' folder or whatever,
	// but otherwise we need to give it a fake one
	if (!options.root) {
		options.root = (
			process.platform === 'win32'
				? 'X:\\__exhibit-root'
				: '/__exhibit-root'
		);
	} else options.root = path.resolve(options.root);

	// TODO: alias option names (eg sourceMap -> sourceMaps)

	// return the caching builder
	return cache(async (contents, name, include) => {
		if (!match(name)) return contents;
		if (!matchEntry(name)) return null;

		// monkey-patch Browserify for this one job
		Browserify.prototype._createDeps = getCreateDeps(options.root, include);

		// make a browserify instance
		const b = new Browserify(browserifyOptions);

		// browserify expects a stream, not a buffer
		const stream = createReadStream(contents);
		stream.file = path.resolve(options.root, name); // https://github.com/substack/node-browserify/issues/816
		b.add(stream);

		// bundle it
		return promisify(b.bundle.bind(b))()
			// .then(bundledContents => {
			// 	// output the bundle
			// 	return bundledContents;
			// })
			.catch(err => {
				// can't throw a CodeError due to
				// https://github.com/substack/node-browserify/issues/1117
				// TODO: find workaround?
				throw err;
			});

		// let result;
		// try {
		// 	result = babel.transform(source, compileOptions);
		// }
		// catch (error) {
		// 	throw error;

		// 	// TODO - print a pretty excerpt before throwing?

		// 	// todo: remove the "(line:column)" from end of message
		// 	// throw new util.SourceError({
		// 	//   file,
		// 	//   message: error.message,
		// 	//   contents: source,
		// 	//   line: error.loc ? error.loc.line : null,
		// 	//   column: error.loc ? error.loc.column : null,
		// 	// });
		// }

		// if (options.sourceMaps) {
		// 	delete result.map.sourceRoot;

		// 	const comment = convertSourceMap
		// 		.fromObject(result.map)
		// 		.setProperty('sources', [name])
		// 		.setProperty('sourcesContent', [source])
		// 		.toComment();

		// 	return `${result.code}\n${comment}`;
		// }

		// return result.code;
	});
}
