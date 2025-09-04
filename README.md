# Kubo HTTP Router Issues Test

This test suite reproduces two bugs in kubo's HTTP routing behavior during CID fetching operations:
1. **Offline routers**: Hangs indefinitely when HTTP routers are unreachable
2. **No providers found**: Hangs until timeout when routers return HTTP 404 "no providers found"

## Bug Descriptions

### Bug 1: Offline HTTP Routers
When kubo is configured to use HTTP routers for provider discovery and those routers are offline (connection refused), CID fetching operations hang indefinitely without proper error handling.

### Bug 2: No Providers Found Response
When HTTP routers are online but return HTTP 404 "no providers found" responses, kubo treats this as a temporary error and hangs by repeatedly retrying the same routers until timeout, instead of recognizing 404 as a definitive answer.

## Setup

1. Install dependencies:
```bash
npm install
```

## Running the Tests

**Test offline routers (Bug 1):**
```bash
npm test
# or
node test-offline-peer-routing.js
```

**Test no providers response (Bug 2):**
```bash
node test-no-providers-http-routing.js
```

## What the Tests Do

### test-offline-peer-routing.js (Bug 1)
1. **Port Check**: Verifies required ports are available
2. **Kubo Setup**: Initializes a fresh IPFS repo with custom routing configuration
3. **Router Configuration**: Sets up HTTP routers pointing to offline endpoints (127.0.0.1:19999, 127.0.0.1:19998)
4. **Daemon Start**: Launches kubo daemon with the offline router config
5. **CID Fetching Test**: `ipfs cat <cid>` - Fetch CID content (triggers provider discovery)
6. **Analysis**: Reports whether operations hang, fail properly, or behave unexpectedly

### test-no-providers-http-routing.js (Bug 2)
1. **Mock Router Setup**: Creates HTTP servers that respond with 404 "no providers found"
2. **Kubo Setup**: Initializes IPFS repo configured to use the mock routers
3. **CID Fetching Test**: `ipfs cat <cid>` - Triggers provider discovery from mock routers
4. **Analysis**: Monitors retry behavior and reports inefficient retry patterns

## Expected vs Actual Behavior

### Bug 1: Offline Routers
**Expected**: CID fetch should fail immediately with clear error when HTTP routers are unreachable
**Actual**: CID fetch hangs indefinitely without proper error handling

### Bug 2: No Providers Found  
**Expected**: CID fetch should fail immediately after first round of queries when routers return 404 "no providers found"
**Actual**: CID fetch hangs by repeatedly retrying the same routers until timeout, treating 404 as temporary error

## Test Configuration

- **Kubo Version**: 0.37.0
- **Test Ports**: 54321-54323 (Kubo), 19999-19998 (Offline/Mock routers)
- **Timeout**: 60-120 seconds for CID fetch operations
- **Router Timeout**: 5 seconds per HTTP router
- **IgnoreErrors**: false (errors should not be ignored)
- **Test CID**: QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o (Hello World)

## Cleanup

Both tests automatically clean up temporary IPFS repositories, daemon processes, and mock HTTP servers.