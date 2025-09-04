const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');

// Configuration
const CID_FETCH_TIMEOUT_MS = 120000; // Timeout for CID fetch operation in milliseconds
const HTTP_ROUTER_1_PORT = 19999;
const HTTP_ROUTER_2_PORT = 19998;
const IGNORE_ERRORS = true; // Set to true to test with IgnoreErrors: true

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.listen(port, host, () => {
      server.close(() => {
        resolve(true);
      });
    });
    
    server.on('error', () => {
      resolve(false);
    });
  });
}

async function checkRequiredPorts() {
  const requiredPorts = [
    { port: 54321, description: 'Kubo Swarm' },
    { port: 54322, description: 'Kubo API' },
    { port: 54323, description: 'Kubo Gateway' },
    { port: HTTP_ROUTER_1_PORT, description: 'HTTP Router 1 (will return no providers)' },
    { port: HTTP_ROUTER_2_PORT, description: 'HTTP Router 2 (will return no providers)' }
  ];
  
  console.log('Checking required ports...');
  
  for (const { port, description } of requiredPorts) {
    const isFree = await checkPortFree(port);
    
    if (!isFree) {
      console.log(`❌ Port ${port} (${description}) is occupied`);
      console.log(`   Please stop any service using port ${port}`);
      return false;
    } else {
      console.log(`✅ Port ${port} (${description}) is free`);
    }
  }
  
  console.log('All required ports are available\n');
  return true;
}

function createNoProvidersHttpRouter(port) {
  const server = http.createServer((req, res) => {
    console.log(`HTTP Router on port ${port} received request: ${req.method} ${req.url}`);
    
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    // Handle provider queries according to IPFS HTTP Routing V1 spec
    if (req.method === 'GET' && req.url.match(/\/routing\/v1\/providers\/[^\/]+/)) {
      console.log(`HTTP Router on port ${port} returning 404 (no providers found) for provider query`);
      // According to spec: 404 indicates "no matching records are found"
      res.writeHead(404, { 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      });
      res.end(JSON.stringify({
        Message: "no providers found"
      }));
      return;
    }
    
    // Handle other routing endpoints
    if (req.url.startsWith('/routing/v1/')) {
      console.log(`HTTP Router on port ${port} handling routing request: ${req.url}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ Message: "not found" }));
      return;
    }
    
    // For non-routing requests, return 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ Message: "not found" }));
  });
  
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`HTTP Router started on port ${port} (will return 404 for provider queries)`);
      resolve(server);
    });
    
    server.on('error', reject);
  });
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    
    process.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('exit', (code) => {
      resolve({ code, stdout, stderr });
    });
    
    process.on('error', (error) => {
      reject(error);
    });
  });
}

async function initializeIpfsRepo(ipfsRepoPath) {
  console.log('Initializing IPFS repository...');
  
  if (fs.existsSync(ipfsRepoPath)) {
    fs.rmSync(ipfsRepoPath, { recursive: true, force: true });
  }
  
  const kuboPath = path.join(__dirname, 'node_modules', 'kubo', 'kubo', 'ipfs');
  const result = await runCommand(kuboPath, ['init'], {
    env: { ...process.env, IPFS_PATH: ipfsRepoPath }
  });
  
  if (result.code !== 0) {
    throw new Error(`Failed to initialize IPFS repo: ${result.stderr}`);
  }
  
  console.log('IPFS repo initialized successfully');
  
  const configPath = path.join(ipfsRepoPath, 'config');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  // Configure routing to use HTTP routers that return no providers
  config.Routing = {
    "Methods": {
      "find-peers": {
        "RouterName": "HttpRouterNotSupported"
      },
      "find-providers": {
        "RouterName": "HttpRoutersParallel" 
      },
      "get-ipns": {
        "RouterName": "HttpRouterNotSupported"
      },
      "provide": {
        "RouterName": "HttpRoutersParallel"
      },
      "put-ipns": {
        "RouterName": "HttpRouterNotSupported"
      }
    },
    "Routers": {
      "HttpRouter1": {
        "Parameters": {
          "Endpoint": `http://127.0.0.1:${HTTP_ROUTER_1_PORT}`
        },
        "Type": "http"
      },
      "HttpRouter2": {
        "Parameters": {
          "Endpoint": `http://127.0.0.1:${HTTP_ROUTER_2_PORT}`
        },
        "Type": "http"
      },
      "HttpRouterNotSupported": {
        "Parameters": {
          "Endpoint": "http://kubohttprouternotsupported"
        },
        "Type": "http"
      },
      "HttpRoutersParallel": {
        "Parameters": {
          "Routers": [
            {
              "IgnoreErrors": IGNORE_ERRORS,
              "RouterName": "HttpRouter1",
              "Timeout": "5s"
            },
            {
              "IgnoreErrors": IGNORE_ERRORS,
              "RouterName": "HttpRouter2", 
              "Timeout": "5s"
            }
          ]
        },
        "Type": "parallel"
      }
    },
    "Type": "custom"
  };
  
  config.Addresses.Swarm = [
    "/ip4/0.0.0.0/tcp/54321",
    "/ip6/::/tcp/54321",
    "/ip4/0.0.0.0/udp/54321/webrtc-direct",
    "/ip4/0.0.0.0/udp/54321/quic-v1",
    "/ip4/0.0.0.0/udp/54321/quic-v1/webtransport",
    "/ip6/::/udp/54321/webrtc-direct",
    "/ip6/::/udp/54321/quic-v1",
    "/ip6/::/udp/54321/quic-v1/webtransport"
  ];
  config.Addresses.API = "/ip4/127.0.0.1/tcp/54322";
  config.Addresses.Gateway = "/ip4/127.0.0.1/tcp/54323";
  
  config.Discovery.MDNS.Enabled = false;
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('IPFS config updated with HTTP routers that return no providers');
}

async function verifyKuboVersion(expectedVersion = '0.37.0') {
  console.log(`Verifying kubo version is ${expectedVersion}...`);
  
  const kuboPath = path.join(__dirname, 'node_modules', 'kubo', 'kubo', 'ipfs');
  const result = await runCommand(kuboPath, ['version']);
  
  if (result.code !== 0) {
    throw new Error(`Failed to get kubo version: ${result.stderr}`);
  }
  
  const versionMatch = result.stdout.match(/ipfs version (\d+\.\d+\.\d+)/);
  if (!versionMatch) {
    throw new Error(`Could not parse version from: ${result.stdout}`);
  }
  
  const actualVersion = versionMatch[1];
  if (actualVersion !== expectedVersion) {
    throw new Error(`Version mismatch: expected ${expectedVersion}, got ${actualVersion}`);
  }
  
  console.log(`✅ Kubo version verified: ${actualVersion}`);
}

async function verifyKuboConfig(ipfsRepoPath) {
  console.log('Verifying kubo config for HTTP routers that return no providers...');
  
  const kuboPath = path.join(__dirname, 'node_modules', 'kubo', 'kubo', 'ipfs');
  const result = await runCommand(kuboPath, ['config', 'show'], {
    env: { ...process.env, IPFS_PATH: ipfsRepoPath }
  });
  
  if (result.code !== 0) {
    throw new Error(`Failed to get kubo config: ${result.stderr}`);
  }
  
  const config = JSON.parse(result.stdout);
  
  if (config.Routing?.Type !== 'custom') {
    throw new Error(`Expected Routing.Type to be 'custom', got '${config.Routing?.Type}'`);
  }
  
  const findProvidersRouter = config.Routing?.Methods?.['find-providers']?.RouterName;
  if (findProvidersRouter !== 'HttpRoutersParallel') {
    throw new Error(`Expected find-providers RouterName to be 'HttpRoutersParallel', got '${findProvidersRouter}'`);
  }
  
  const httpRouter1 = config.Routing?.Routers?.HttpRouter1;
  const httpRouter2 = config.Routing?.Routers?.HttpRouter2;
  
  if (httpRouter1?.Parameters?.Endpoint !== `http://127.0.0.1:${HTTP_ROUTER_1_PORT}`) {
    throw new Error(`Expected HttpRouter1 endpoint to be 'http://127.0.0.1:${HTTP_ROUTER_1_PORT}', got '${httpRouter1?.Parameters?.Endpoint}'`);
  }
  
  if (httpRouter2?.Parameters?.Endpoint !== `http://127.0.0.1:${HTTP_ROUTER_2_PORT}`) {
    throw new Error(`Expected HttpRouter2 endpoint to be 'http://127.0.0.1:${HTTP_ROUTER_2_PORT}', got '${httpRouter2?.Parameters?.Endpoint}'`);
  }
  
  const parallelRouters = config.Routing?.Routers?.HttpRoutersParallel?.Parameters?.Routers;
  if (parallelRouters) {
    for (const router of parallelRouters) {
      if (router.IgnoreErrors !== IGNORE_ERRORS) {
        throw new Error(`Expected IgnoreErrors to be ${IGNORE_ERRORS} for ${router.RouterName}, got ${router.IgnoreErrors}`);
      }
    }
  }
  
  console.log('✅ Kubo config verified: HTTP routers configured to return no providers');
}

async function testNoProvidersHttpRouting() {
  console.log('Testing kubo provider finding behavior with HTTP routers that return no providers...\n');

  try {
    await verifyKuboVersion();
  } catch (error) {
    console.error(`❌ Version verification failed: ${error.message}`);
    process.exit(1);
  }

  const portsAvailable = await checkRequiredPorts();
  if (!portsAvailable) {
    console.error('\n❌ Port conflict detected. Please resolve port conflicts before running the test.');
    process.exit(1);
  }

  const ipfsRepoPath = path.join(__dirname, '.ipfs');
  
  try {
    await initializeIpfsRepo(ipfsRepoPath);
  } catch (error) {
    console.error('Failed to initialize IPFS repo:', error);
    process.exit(1);
  }

  console.log('\n1. Starting HTTP routers that return no providers...');
  
  let httpRouter1, httpRouter2;
  
  try {
    httpRouter1 = await createNoProvidersHttpRouter(HTTP_ROUTER_1_PORT);
    httpRouter2 = await createNoProvidersHttpRouter(HTTP_ROUTER_2_PORT);
  } catch (error) {
    console.error('Failed to start HTTP routers:', error);
    process.exit(1);
  }
  
  console.log('\n2. Starting IPFS daemon...');
  
  const kuboPath = path.join(__dirname, 'node_modules', 'kubo', 'kubo', 'ipfs');
  const daemon = spawn(kuboPath, ['daemon'], {
    env: {
      ...process.env,
      IPFS_PATH: ipfsRepoPath
    },
    stdio: 'pipe'
  });

  let daemonReady = false;
  let daemonOutput = '';
  
  daemon.stdout.on('data', (data) => {
    const output = data.toString();
    daemonOutput += output;
    console.log('DAEMON:', output.trim());
    
    if (output.includes('Daemon is ready')) {
      daemonReady = true;
    }
  });

  daemon.stderr.on('data', (data) => {
    const output = data.toString();
    daemonOutput += output;
    console.log('DAEMON ERROR:', output.trim());
  });

  while (!daemonReady) {
    await sleep(1000);
    if (daemon.exitCode !== null) {
      console.log('Daemon exited unexpectedly with code:', daemon.exitCode);
      console.log('Full daemon output:', daemonOutput);
      process.exit(1);
    }
  }

  console.log('\n3. Daemon is ready. Verifying configuration...\n');
  
  try {
    await verifyKuboConfig(ipfsRepoPath);
  } catch (error) {
    console.error(`❌ Config verification failed: ${error.message}`);
    await cleanup(daemon, httpRouter1, httpRouter2);
    process.exit(1);
  }

  console.log('\n4. Testing CID fetching with HTTP routers returning no providers...\n');

  try {
    const testCid = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o'; // Hello World CID

    // Test: Fetch a CID (this should trigger provider discovery)
    console.log('Test: Fetching CID content (this should trigger provider discovery)...');
    console.log('CID:', testCid);
    
    const getProcess = spawn(kuboPath, ['cat', testCid], {
      env: {
        ...process.env,
        IPFS_PATH: ipfsRepoPath
      },
      stdio: 'pipe'
    });

    let getOutput = '';
    let getError = '';
    let getExited = false;
    let getExitCode = null;

    getProcess.stdout.on('data', (data) => {
      getOutput += data.toString();
    });

    getProcess.stderr.on('data', (data) => {
      getError += data.toString();
    });

    getProcess.on('exit', (code) => {
      getExited = true;
      getExitCode = code;
    });

    const startTime2 = Date.now();
    
    console.log(`Waiting for CID fetch to complete (${CID_FETCH_TIMEOUT_MS / 1000} second timeout)...`);
    while (!getExited && (Date.now() - startTime2) < CID_FETCH_TIMEOUT_MS) {
      await sleep(1000);
      if ((Date.now() - startTime2) % 10000 === 0) {
        console.log(`Still waiting... ${Math.floor((Date.now() - startTime2) / 1000)}s elapsed`);
      }
    }

    if (!getExited) {
      console.log(`CID FETCH OPERATION TIMED OUT after ${CID_FETCH_TIMEOUT_MS / 1000} seconds`);
      getProcess.kill('SIGKILL');
      await sleep(1000);
    }

    console.log('\n=== CID FETCH RESULTS ===');
    console.log('Exit code:', getExitCode);
    console.log('Process exited:', getExited);
    console.log('Stdout length:', getOutput.length);
    console.log('Stdout content:', JSON.stringify(getOutput));
    console.log('Stderr length:', getError.length);
    console.log('Stderr content:', JSON.stringify(getError));
    console.log('Timeout reached:', !getExited);

    // Analyze CID fetch results
    console.log('\n=== CID FETCH ANALYSIS ===');
    
    if (!getExited) {
      console.log('❌ BUG CONFIRMED: CID fetch hung without proper error handling');
      console.log('Expected: Operation should fail QUICKLY with clear error message since routers return no providers');
      console.log('         (Should detect empty provider responses and fail gracefully)');
      console.log('Actual: Operation hangs indefinitely during provider discovery without any error output');
    } else if (getExitCode !== 0 && getError.length > 0) {
      console.log('✅ EXPECTED: CID fetch failed quickly with error message');
      console.log('This is the expected behavior when routers return no providers');
      
      if (getError.includes('no providers') || getError.includes('not found') || getError.includes('routing')) {
        console.log('✅ Proper error messages about no providers found');
      } else {
        console.log('⚠️  Error messages could be more specific about no providers returned');
      }
    } else if (getExitCode !== 0 && getError.length === 0) {
      console.log('❌ BUG CONFIRMED: CID fetch failed but without proper error message');
      console.log('Expected: Clear error message explaining that no providers were found');
      console.log('         (Should fail quickly since routers return empty provider lists)');
      console.log('Actual: Silent failure without informative error message');
    } else if (getExitCode === 0) {
      console.log('❌ UNEXPECTED: CID fetch succeeded despite no providers returned');
      console.log('This suggests the content was found via alternative means (local cache, etc.)');
    } else {
      console.log('❌ BUG CONFIRMED: CID fetch timed out without proper error handling');
      console.log('Expected: Operation should fail QUICKLY with clear error message since routers return no providers');
      console.log('         (No long timeout should be needed - kubo should detect empty provider responses quickly)');
      console.log('Actual: Operation was killed after timeout without any error output');
    }

  } catch (error) {
    console.log('\n🔍 Exception caught during operations:');
    console.log('Error:', error.message);
    console.log('This could indicate proper error handling when no providers are returned');
  } finally {
    await cleanup(daemon, httpRouter1, httpRouter2);
    console.log('\nTest completed.');
  }
}

async function cleanup(daemon, httpRouter1, httpRouter2) {
  if (daemon && daemon.exitCode === null) {
    console.log('\n5. Shutting down daemon...');
    daemon.kill('SIGTERM');
    
    let attempts = 0;
    while (daemon.exitCode === null && attempts < 10) {
      await sleep(500);
      attempts++;
    }
    
    if (daemon.exitCode === null) {
      console.log('Force killing daemon...');
      daemon.kill('SIGKILL');
      await sleep(1000);
    }
  }
  
  if (httpRouter1) {
    console.log('Shutting down HTTP Router 1...');
    httpRouter1.close();
  }
  
  if (httpRouter2) {
    console.log('Shutting down HTTP Router 2...');
    httpRouter2.close();
  }
}

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, cleaning up...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, cleaning up...');
  process.exit(0);
});

testNoProvidersHttpRouting().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});