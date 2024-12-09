import { exec } from "child_process";
import fs from 'fs';
import path from "path";

import { CheckedContract, checkPaths } from "@ethereum-sourcify/lib-sourcify";

function asyncExecSolc(inputStringified, solcPath) {
  return new Promise((resolve, reject) => {
    const child = exec(
      `${solcPath} --standard-json`,
      {
        maxBuffer: 1000 * 1000 * 20,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else if (stderr) {
          reject(
            new Error(`Compiler process returned with errors:\n ${stderr}`)
          );
        } else {
          resolve(stdout);
        }
      }
    );
    if (!child.stdin) {
      throw new Error("No stdin on child process");
    }
    // Write input to child process's stdin
    child.stdin.write(inputStringified);
    child.stdin.end();
  });
}


async function fetchAndSaveSolc(platform, solcPath, fileName) {
  const encodedURIFilename = encodeURIComponent(fileName);
  const HOST_SOLC_REPO = "https://binaries.soliditylang.org/";
  const githubSolcURI = `${HOST_SOLC_REPO}${platform}/${encodedURIFilename}`;
  let res = await fetch(githubSolcURI);
  let status = res.status;
  let buffer;

  // handle case in which the response is a link to another version
  if (status === 200) {
    buffer = await res.arrayBuffer();
    const responseText = Buffer.from(buffer).toString();
    if (
      /^([\w-]+)-v(\d+\.\d+\.\d+)\+commit\.([a-fA-F0-9]+).*$/.test(responseText)
    ) {
      const githubSolcURI = `${HOST_SOLC_REPO}${platform}/${responseText}`;
      res = await fetch(githubSolcURI);
      status = res.status;
      buffer = await res.arrayBuffer();
    }
  }

  if (status === 200 && buffer) {
    // console.log("Fetched solc", { version, platform, githubSolcURI });
    fs.mkdirSync(path.dirname(solcPath), { recursive: true });
    try {
      fs.unlinkSync(solcPath);
    } catch (_e) {
    }
    fs.writeFileSync(solcPath, new DataView(buffer), { mode: 0o755 });

    return true;
  }

  return false;
}
async function getSolcExecutable(version) {
  const platform = 'linux-amd64';
  const fileName = `solc-${platform}-v${version}`;
  const solcPath = `./solc-repo/${fileName}`
  if (fs.existsSync(solcPath)) {
    return solcPath;
  }
  const success = await fetchAndSaveSolc(platform, solcPath, fileName);
  return success ? solcPath : null;
}


class Solc {
  async compile(version, solcJsonInput, forceEmscripten = false) {
    // For nightly builds, Solidity version is saved as 0.8.17-ci.2022.8.9+commit.6b60524c instead of 0.8.17-nightly.2022.8.9+commit.6b60524c.
    // Not possible to retrieve compilers with "-ci.".
    if (version.includes("-ci.")) version = version.replace("-ci.", "-nightly.");

    let q = solcJsonInput.settings.outputSelection['*']['*'];
    for (const k of ['storageLayout', 'abi', 'evm.deployedBytecode.object']) {
      if (!q.includes(k)) {
        q.push(k);
      }
    }
    // console.log(solcJsonInput.settings.outputSelection);

    const inputStringified = JSON.stringify(solcJsonInput);

    let compiled;

    let solcPath;
    if (!forceEmscripten) {
      solcPath = await getSolcExecutable(version);
    }
    if (solcPath && !forceEmscripten) {
      try {
        compiled = await asyncExecSolc(inputStringified, solcPath);
      } catch (error) {
        if (error?.code === "ENOBUFS") {
          throw new Error("Compilation output size too large");
        }
        throw error;
      }
    } else {
      const solJson = await getSolcJs(version);
      startCompilation = Date.now();
      if (solJson) {
        const coercedVersion =
          semver.coerce(new semver.SemVer(version))?.version ?? "";
        // Run Worker for solc versions < 0.4.0 for clean compiler context. See https://github.com/ethereum/sourcify/issues/1099
        if (semver.lt(coercedVersion, "0.4.0")) {
          compiled = await new Promise((resolve, reject) => {
            const worker = importWorker(
              path.resolve(__dirname, "./compilerWorker.ts"),
              {
                workerData: { version, inputStringified },
              }
            );
            worker.once("message", (result) => {
              resolve(result);
            });
            worker.once("error", (error) => {
              reject(error);
            });
          });
        } else {
          compiled = solJson.compile(inputStringified);
        }
      }
    }
    if (!compiled) {
      throw new Error("Compilation failed. No output from the compiler.");
    }
    const compiledJSON = JSON.parse(compiled);
    const errorMessages = compiledJSON?.errors?.filter(
      (e) => e.severity === "error"
    );
    if (errorMessages && errorMessages.length > 0) {
      const error = new Error(
        "Compiler error:\n " + JSON.stringify(errorMessages)
      );
      console.error(error.message);
      throw error;
    }

    for (const [k, v] of Object.entries(compiledJSON.contracts)) {
      for (const [kk, vv] of Object.entries(v)) {
        compiledJSON.contracts[k][kk].metadata = JSON.stringify({storageLayout: vv.storageLayout, abi: vv.abi});
      }
    }

    return compiledJSON;
  }
}

const solc = new Solc()

const argv = process.argv;
const dir = argv[2];
console.log('++++++ GO', dir);

const checkedContracts = await checkPaths(solc, [dir]);

const ck = checkedContracts[0];
if (!CheckedContract.isValid(ck)) {
  throw 'not valid';
}

const rc = await ck.recompile();
const {storageLayout, abi} = JSON.parse(rc.metadata);
let runtimeBytecode = rc.runtimeBytecode;

if (storageLayout === undefined) {
  throw 'no storage layout';
}

const lpath = `${dir}/library-map.json`;
if (fs.existsSync(lpath)) {
  const lmap = JSON.parse(fs.readFileSync(lpath));
  for (const [k, v] of Object.entries(lmap)) {
    runtimeBytecode = runtimeBytecode.replaceAll(k, v);
  }
}


const res = {
  runtimeBytecode,
  storageLayout,
  abi,
}

const cname = dir.split('/').slice(-1)[0];
fs.writeFileSync(`out/${cname}.json`, JSON.stringify(res), 'utf8');

// find /mnt/sourcify/sources/contracts/full_match/1 -mindepth 1 -maxdepth 1 -type d|shuf | head -n 4000 | xargs -n1 -P16 node index.mjs
// md5sum out/* | sort | uniq -w 32 | shuf | head -n 3000 | awk '{print $2}' | xargs -I{} cp {} storage3k/
