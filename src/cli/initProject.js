var fsExtra = require('fs-extra');
var childProcess = require('child_process');

// CVE-2023-26127: targetPath used to be concatenated into a `sh -c '...'` string, so a
// project name like `x'; rm -rf ~; '` ran arbitrary commands. Now user input never reaches
// a command line: the target path is only the child's cwd, and the command and its
// arguments are constants. (Windows needs a shell to run npm.cmd since Node's
// CVE-2024-27980 fix; that is safe here because nothing in the command is user-controlled.)
var IS_WINDOWS = process.platform === 'win32';

function runNpm (args, cwd) {
    var result = childProcess.spawnSync('npm', args, {
        cwd: cwd,
        stdio: 'inherit',
        shell: IS_WINDOWS
    });
    if (result.error) {
        throw result.error;
    }
    return result.status;
}

module.exports = function (seedPath, targetPath) {
    if (typeof targetPath !== 'string' || !targetPath) {
        throw new Error('n158 init: invalid target path');
    }
    if (fsExtra.existsSync(targetPath)) {
        throw new Error('n158 init: ' + targetPath + ' already exists');
    }
    console.log('Setting up project');
    fsExtra.copySync(seedPath, targetPath);
    console.log('Installing dependencies');
    var status = runNpm(['install'], targetPath);
    if (status !== 0) {
        console.log('npm install failed with exit code ' + status);
        process.exitCode = status || 1;
        return;
    }
    console.log('Starting server');
    process.exitCode = runNpm(['start'], targetPath) || 0;
}
