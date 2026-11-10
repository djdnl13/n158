var path = require('path');
var initProject = require('./initProject');

// Project names become a directory under the current one: letters, digits, '.', '_' and '-'
// only, so the name can't climb out of cwd (`../x`) or be absolute.
var PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Minimal `--key value` / `--key=value` parser (replaces yargs, the CLI's only use of it).
function parseArgs (args) {
    var out = {};
    for (var i = 0; i < args.length; i++) {
        var m = /^--([^=]+)(?:=(.*))?$/.exec(args[i]);
        if (!m) continue;
        if (m[2] !== undefined) {
            out[m[1]] = m[2];
        } else if (i + 1 < args.length && args[i + 1].indexOf('--') !== 0) {
            out[m[1]] = args[++i];
        } else {
            out[m[1]] = true;
        }
    }
    return out;
}

// Arguments setup
var action = process.argv[2];
var argv = parseArgs(process.argv.slice(3));

switch (action) {
    case 'init':
        if (!argv.name || argv.name === true) {
            console.log('--name argument must be passed');
            process.exitCode = 1;
            break;
        }
        if (!PROJECT_NAME.test(argv.name)) {
            console.log('--name may only contain letters, digits, ".", "_" and "-"');
            process.exitCode = 1;
            break;
        }
        var seedPath = path.join(__dirname, '../seed');
        var targetPath = path.join(process.cwd(), argv.name);
        try {
            initProject(seedPath, targetPath);
        } catch (err) {
            console.log(err.message);
            process.exitCode = 1;
        }
    break;
    default:
        console.log('action param is required');
    break;
}
