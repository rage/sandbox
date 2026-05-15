# TMC-sandbox

## Development environment

Requirements: pnpm (nodejs 22+), docker, tar, zstd, ts (from moreutils).

```bash
pnpm install
export DOCKER_RUNTIME=runc
pnpm dev
```

`DOCKER_RUNTIME` is required. Use `runc` for the standard Docker runtime or `runsc` for gVisor.

If you wish to see the VM Log in the terminal, run:

```bash
export PRINT_VM_LOG=1
```

## Running tests

```bash
pnpm test
```
