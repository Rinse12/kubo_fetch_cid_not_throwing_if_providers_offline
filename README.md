# Kubo Offline HTTP Router Test

This test script reproduces a bug where kubo hangs or times out without proper error handling when HTTP routers are configured but offline during CID fetching operations.

## Bug Description

When kubo is configured to use HTTP routers for provider discovery (`find-providers`) and those routers are offline, CID fetching operations may hang indefinitely without throwing proper errors indicating the routers are unreachable.

## Setup

1. Install dependencies:
```bash
npm install
```

## Running the Test

```bash
npm test
```

## What the Test Does

1. **Port Check**: Verifies required ports are available
2. **Kubo Setup**: Initializes a fresh IPFS repo with custom routing configuration
3. **Router Configuration**: Sets up HTTP routers pointing to offline endpoints (127.0.0.1:19999, 127.0.0.1:19998)
4. **Daemon Start**: Launches kubo daemon with the offline router config
5. **CID Fetching Test**:
   - `ipfs cat <cid>` - Fetch CID content (triggers provider discovery)
6. **Analysis**: Reports whether operations hang, fail properly, or behave unexpectedly

## Expected vs Actual Behavior

**Expected**: CID fetch should fail quickly with clear error messages when HTTP routers are offline

**Potential Bug**: CID fetch may hang indefinitely without timeout or proper error handling

## Test Configuration

- **Kubo Version**: 0.37.0
- **Test Ports**: 54321-54323 (Kubo), 19999-19998 (Offline routers)
- **Timeout**: 60 seconds for CID fetch
- **Router Timeout**: 5 seconds per HTTP router
- **IgnoreErrors**: false (errors should not be ignored)

## Cleanup

The test automatically cleans up the temporary IPFS repository and daemon process.