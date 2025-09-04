const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

// Configuration
const SKIP_FINDPROVS_TEST = true; // Set to true to skip findprovs and go straight to CID fetching

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
    { port: 19999, description: 'HTTP Router 1 (should be offline)' },
    { port: 19998, description: 'HTTP Router 2 (should be offline)' }
  ];
  
  console.log('Checking required ports...');
  
  for (const { port, description } of requiredPorts) {
    const isFree = await checkPortFree(port);
    
    if (port === 19999 || port === 19998) {
      if (!isFree) {
        console.log(`❌ Port ${port} (${description}) is occupied - this may interfere with the test`);
        console.log(`   Please stop any service using port ${port}`);
        return false;
      } else {
        console.log(`✅ Port ${port} (${description}) is free (as expected)`);
      }
    } else {
      if (!isFree) {
        console.log(`❌ Port ${port} (${description}) is occupied`);
        console.log(`   Please stop any IPFS daemon or service using port ${port}`);
        return false;
      } else {
        console.log(`✅ Port ${port} (${description}) is free`);
      }
    }
  }
  
  console.log('All required ports are available\n');
  return true;
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
  
  // Configure routing to use offline HTTP routers for provider finding
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
          "Endpoint": "http://127.0.0.1:19999"
        },
        "Type": "http"
      },
      "HttpRouter2": {
        "Parameters": {
          "Endpoint": "http://127.0.0.1:19998"
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
              "IgnoreErrors": false,
              "RouterName": "HttpRouter1",
              "Timeout": "5s"
            },
            {
              "IgnoreErrors": false,
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
  console.log('IPFS config updated with offline HTTP routers for provider finding');
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
  console.log('Verifying kubo config for provider finding with offline routers...');
  
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
  
  if (httpRouter1?.Parameters?.Endpoint !== 'http://127.0.0.1:19999') {
    throw new Error(`Expected HttpRouter1 endpoint to be 'http://127.0.0.1:19999', got '${httpRouter1?.Parameters?.Endpoint}'`);
  }
  
  if (httpRouter2?.Parameters?.Endpoint !== 'http://127.0.0.1:19998') {
    throw new Error(`Expected HttpRouter2 endpoint to be 'http://127.0.0.1:19998', got '${httpRouter2?.Parameters?.Endpoint}'`);
  }
  
  const parallelRouters = config.Routing?.Routers?.HttpRoutersParallel?.Parameters?.Routers;
  if (parallelRouters) {
    for (const router of parallelRouters) {
      if (router.IgnoreErrors !== false) {
        throw new Error(`Expected IgnoreErrors to be false for ${router.RouterName}, got ${router.IgnoreErrors}`);
      }
    }
  }
  
  console.log('✅ Kubo config verified: offline routers configured for provider finding');
}

async function testOfflinePeerRouting() {
  console.log('Testing kubo provider finding behavior with offline HTTP routers...\n');

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
  
  console.log('\n1. Starting IPFS daemon with offline HTTP routers...');
  
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

  console.log('\n2. Daemon is ready. Verifying configuration...\n');
  
  try {
    await verifyKuboConfig(ipfsRepoPath);
  } catch (error) {
    console.error(`❌ Config verification failed: ${error.message}`);
    await cleanupDaemon(daemon);
    process.exit(1);
  }

  console.log('\n3. Testing operations with offline HTTP routers...\n');

  try {
    const testCid = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o'; // Hello World CID

    if (!SKIP_FINDPROVS_TEST) {
      // Test: Find providers for a CID  
      console.log('Test: Finding providers for test CID...');
      
      const findProvidersProcess = spawn(kuboPath, ['routing', 'findprovs', testCid], {
        env: {
          ...process.env,
          IPFS_PATH: ipfsRepoPath
        },
        stdio: 'pipe'
      });

      let findProvidersOutput = '';
      let findProvidersError = '';
      let findProvidersExited = false;
      let findProvidersExitCode = null;

      findProvidersProcess.stdout.on('data', (data) => {
        findProvidersOutput += data.toString();
      });

      findProvidersProcess.stderr.on('data', (data) => {
        findProvidersError += data.toString();
      });

      findProvidersProcess.on('exit', (code) => {
        findProvidersExited = true;
        findProvidersExitCode = code;
      });

      const startTime = Date.now();
      const timeout = 30000; // 30 seconds
      
      while (!findProvidersExited && (Date.now() - startTime) < timeout) {
        await sleep(100);
      }

      if (!findProvidersExited) {
        console.log('FIND PROVIDERS OPERATION TIMED OUT after 30 seconds');
        findProvidersProcess.kill('SIGKILL');
        await sleep(1000);
      }

      console.log('\n=== FIND PROVIDERS RESULTS ===');
      console.log('Exit code:', findProvidersExitCode);
      console.log('Stdout:', findProvidersOutput);
      console.log('Stderr:', findProvidersError);
      console.log('Timeout reached:', !findProvidersExited);

      // Analyze results
      console.log('\n=== FIND PROVIDERS ANALYSIS ===');
      
      if (!findProvidersExited) {
        console.log('❌ BUG CONFIRMED: Operation hung without proper error handling');
        console.log('Expected: Operation should fail quickly with clear error message when HTTP routers are offline');
        console.log('Actual: Operation hangs indefinitely without timeout or error');
      } else if (findProvidersExitCode !== 0) {
        console.log('✅ EXPECTED: Operation failed with offline routers');
        console.log('This is the expected behavior when routers are unreachable');
        
        if (findProvidersError.includes('connection refused') || findProvidersError.includes('connect: connection refused')) {
          console.log('✅ Proper error messages about connection issues');
        } else {
          console.log('⚠️  Error messages could be more specific about offline routers');
        }
      } else if (findProvidersExitCode === 0) {
        console.log('❌ UNEXPECTED: Operation succeeded despite offline routers');
        console.log('This suggests the HTTP router configuration is not working as expected');
      }

      console.log('\n' + '='.repeat(50));
    }

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
    const timeout2 = 60000; // 60 seconds for CID fetch
    
    console.log('Waiting for CID fetch to complete (60 second timeout)...');
    while (!getExited && (Date.now() - startTime2) < timeout2) {
      await sleep(1000);
      if ((Date.now() - startTime2) % 10000 === 0) {
        console.log(`Still waiting... ${Math.floor((Date.now() - startTime2) / 1000)}s elapsed`);
      }
    }

    if (!getExited) {
      console.log('CID FETCH OPERATION TIMED OUT after 60 seconds');
      getProcess.kill('SIGKILL');
      await sleep(1000);
    }

    console.log('\n=== CID FETCH RESULTS ===');
    console.log('Exit code:', getExitCode);
    console.log('Stdout:', getOutput);
    console.log('Stderr:', getError);
    console.log('Timeout reached:', !getExited);

    // Analyze CID fetch results
    console.log('\n=== CID FETCH ANALYSIS ===');
    
    if (!getExited) {
      console.log('❌ BUG CONFIRMED: CID fetch hung without proper error handling');
      console.log('Expected: Operation should fail quickly with clear error message when HTTP routers are offline');
      console.log('Actual: Operation hangs indefinitely during provider discovery');
    } else if (getExitCode !== 0) {
      console.log('✅ EXPECTED: CID fetch failed with offline routers');
      console.log('This is the expected behavior when providers cannot be found via offline routers');
      
      if (getError.includes('connection refused') || getError.includes('connect: connection refused')) {
        console.log('✅ Proper error messages about connection issues');
      } else {
        console.log('⚠️  Error messages could be more specific about offline routers');
      }
    } else if (getExitCode === 0) {
      console.log('❌ UNEXPECTED: CID fetch succeeded despite offline routers');
      console.log('This suggests the content was found via alternative means (DHT, local cache, etc.)');
    }

  } catch (error) {
    console.log('\n🔍 Exception caught during operations:');
    console.log('Error:', error.message);
    console.log('This could indicate proper error handling when routers are offline');
  } finally {
    await cleanupDaemon(daemon);
    console.log('\nTest completed.');
  }
}

async function cleanupDaemon(daemon) {
  if (!daemon || daemon.exitCode !== null) {
    return;
  }
  
  console.log('\n4. Shutting down daemon...');
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

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, cleaning up...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, cleaning up...');
  process.exit(0);
});

testOfflinePeerRouting().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});