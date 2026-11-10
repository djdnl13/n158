# N158

<img src="assets/n158-logo.png" width="200px">

> An easy way to handle HTTP servers and daemons with NodeJS

## Security notice: CVE-2023-26127 (fixed in 1.4.2)

Versions up to and including **1.4.1** have a command injection vulnerability
([CVE-2023-26127](https://nvd.nist.gov/vuln/detail/CVE-2023-26127) /
[GHSA-549h-r7g9-2qpf](https://github.com/advisories/GHSA-549h-r7g9-2qpf), HIGH) in the
`n158 init` CLI: the project path was concatenated into a `sh -c '...'` command, so a crafted
`--name` could run arbitrary shell commands.

**1.4.2 fixes it:**

- `npm install` / `npm start` are run without a shell. The project path is only passed as the
  working directory and the command arguments are constants, so nothing user-controlled is ever
  parsed as a command. (On Windows a shell is needed to run `npm.cmd`; it's still safe because
  the command line contains no user input.)
- `--name` only accepts letters, digits, `.`, `_` and `-`, so it can't be a path (`../x`,
  `/abs`) or contain shell syntax.
- `n158 init` refuses to overwrite an existing directory and exits non-zero if `npm` fails.
- The CLI-only dependencies `shelljs` and `yargs` were removed and every runtime dependency was
  updated to a patched release in the same major version (`npm audit --production`: 0
  vulnerabilities).

The vulnerable code was only in the CLI. Apps that only import the library (`n158/classes`,
`n158/services`, `n158/http-pipeline-handlers`) never ran it, but should still upgrade to get the
patched dependencies.

> npm replaced the `n158` package with a `0.0.1-security` placeholder, so `npm install n158`
> no longer installs this code. Until that's resolved, install it from this repository.

## Requirements

Node.js **14** (see `.nvmrc`).

## CLI

Install the CLI from a checkout of this repository, then create a project:

```bash
npm install --global .
n158 init --name myproject
```

That copies the seed project into `./myproject`, runs `npm install` and starts the example
server. Its sources are in `src/processes/server`.

## Library

```js
const { ProcessHandler, MongoModel } = require('n158/classes');
const { deferResponse } = require('n158/services');
const { modelMongoTransaction } = require('n158/http-pipeline-handlers');
```

- **`ProcessHandler(settings)`**: builds Express servers, routers and route pipelines from a
  settings object or a `.yaml` / `.json` file. String values starting with `$` are replaced by
  process variables set with `processHandler.set(key, value)` (or the `vars` section).
- **Pipeline handlers** are `(context, next, finish) => {}`. `next(status, data)` stores the
  result and continues; `finish(status, data)` sends the response. A handler with
  `skipWhenErrors: true` is skipped once an earlier one set a 4xx/5xx status.
- **`modelMongoTransaction`** is a pipeline handler that instantiates `params.model` with
  `params.db` and calls `params.transaction` with `params.transactionParams`. In those params,
  `&path` reads from the request (`&body`, `&params.id`, `&query`) and `%key.path` reads from a
  value set earlier in the pipeline with `context.set(key, value)`.
- **`MongoModel(db, name, jsonSchema, options)`**: a base class for collections (mongodb 3.x
  driver) with `insert` (validated against `jsonSchema`), `findById`, `findOne`, `findAll`,
  `update`, `rawUpdate`, `removeById` and `aggregate`. `options.indexes` is a list of
  `{ key, options }` created on construction.
- **`deferResponse()`**: a deferred whose `reject(status, details, err)` produces the
  `{ status, details, error }` shape the pipeline turns into an HTTP response.

Example settings (from `test/settings.yaml`):

```yaml
vars:
    httpPort: 8000

httpServers:
    -   name: 'server'
        ports:
            http: '$httpPort'
        routers:
            -   name: 'api'
                path: '/api'
                routes:
                    -   method: 'GET'
                        path: '/demo'
                        pipeline:
                            -   handler: '$demo-handler'
```

### Body size limits

Each server in `httpServers` can set its own body-parser limits. Without `bodyParser` the
limit is 100kb (body-parser's default) for both JSON and urlencoded bodies; larger requests get
`413 Payload Too Large`.

```yaml
vars:
    jsonLimit: '1mb'

httpServers:
    -   name: 'server'
        ports:
            http: 8000
        bodyParser:
            json:
                limit: '$jsonLimit'   # $vars work here too
            urlencoded:
                limit: '200kb'
        routers: [...]
```

`limit` is a number of bytes or a number followed by `b`, `kb`, `mb` or `gb` (`'500kb'`,
`'1.5mb'`). Anything else stops the server from starting, because body-parser would read
some typos as bytes (`'1 megabyte'` becomes 1 byte). If `limit` points to a `$var` that isn't
set, the 100kb default applies. Other keys under `json` / `urlencoded` are passed to
body-parser as they are.

### Request logging

Without `logger`, each server logs requests with `morgan('dev')`, as before:
`GET /api/x 200 4.123 ms - 15`.

```yaml
httpServers:
    -   name: 'server'
        logger:
            format: 'dev'      # dev (default), combined, common, short, tiny, or a format string
            timestamp: true    # prefix each line with the request start time in UTC
```

```
[2026-11-09T21:48:03.512Z] GET /api/x 200 4.123 ms - 15
```

- `timestamp: true` adds the time the request arrived, in UTC (ISO 8601, `Z`), whatever the
  server's time zone is.
- A custom `format` is a [morgan](https://github.com/expressjs/morgan#tokens) format string
  and can use the `:start-utc` token, e.g. `':start-utc :method :url :status'`.
- `logger: false` turns request logging off.
- An unknown format name (`'combind'`) or a non-boolean `timestamp` stops the server from
  starting; morgan would otherwise print the typo as every log line.

Built-in server behavior: gzip compression, JSON and urlencoded bodies (100kb unless set as
above), cookies, request logging (`morgan('dev')` unless set as above), `Access-Control-Allow-Origin: *`
on every response, `OPTIONS` answered with `200 OK`, and no `X-Powered-By` header.

### Known limitations

These behave the same as in 1.4.1. Keep them in mind when exposing models over HTTP:

- `MongoModel.update(id, data)` does **not** validate against the JSON schema (only `insert`
  does) and merges every field of `data` into the document. Don't pass `&body` to `update`
  unchanged: pick the allowed fields first.
- Database errors are returned to the client as-is in the `error` field (driver messages can
  include database, collection, index names and values).
- An invalid id in `findById` / `update` / `removeById` throws, which Express turns into a
  `500`. With `NODE_ENV` not set to `production`, that response includes a stack trace.

## Development

```bash
nvm use            # Node 14
npm ci
npm test           # CLI injection tests + HTTP pipeline tests
npm run compile    # src/resources -> classes/, services/, http-pipeline-handlers/
```

- The compiled files are committed because they are what consumers load. After changing
  anything in `src/resources`, run `npm run compile` and commit the output; CI fails if they're
  out of date.
- `babel.config.json` targets Node 14 but **keeps classes compiled to ES5 functions**.
  Consumers that compile their own code with Babel 6 (`es2015`) subclass `MongoModel` by
  calling its constructor as a function, which throws on a native `class`.
  `test/http-pipeline.test.js` covers this.
- CI (`.github/workflows/test.yml`) runs on Linux and Windows with Node 14.

## Changelog

### 1.4.2

- Fix CVE-2023-26127: no shell in `n158 init`, `--name` validation, refuse existing target
  directories, propagate `npm` exit codes.
- Remove `shelljs` and `yargs`. Update `body-parser`, `compression`, `cookie-parser`,
  `js-yaml`, `jsonschema`, `mongodb`, `morgan` and `underscore` to patched versions (same major
  versions). Declare `express`, which the library always required. All versions are pinned.
- Build with Babel 7 targeting Node 14 (classes still compiled to ES5).
- Add `npm test` and CI.
- Add `bodyParser.json` / `bodyParser.urlencoded` per server in the settings to set body size
  limits (default unchanged: 100kb).
- Add `logger` per server in the settings: format, `timestamp: true` for the request time in
  UTC, or `false` to turn logging off (default unchanged: `morgan('dev')`).
- Remove the unused `services/connectMySQL.js`, which required `mysql`, a package that wasn't
  a dependency.
