# Plan 001: Update Dependencies and Resolve Vulnerabilities

**Git Commit:** `$(git rev-parse --short HEAD)`
**Status:** TODO

## 1. The Goal

This plan addresses the 43 security vulnerabilities reported by `npm audit`, including 15 high and 3 critical. The primary goal is to update all dependencies to their latest non-vulnerable versions, ensuring the application remains stable and functional.

## 2. Verification Gates

The following commands must succeed at the end of the process:

1.  **Dependency Installation:**
    ```bash
    npm install
    ```
    *Expected Output:* Clean exit with no errors.

2.  **Security Audit:**
    ```bash
    npm audit
    ```
    *Expected Output:* `0 vulnerabilities` or a significantly reduced number of low-severity, non-critical vulnerabilities.

3.  **Build Process:**
    ```bash
    npm run build
    ```
    *Expected Output:* Successful compilation of all workspaces without errors.

4.  **Test Suite:**
    ```bash
    npm run test
    ```
    *Expected Output:* All existing tests should pass.

## 3. The Plan

### Step 1: Attempt Automated Fixes

First, we'll use `npm`'s built-in tools to handle the low-hanging fruit.

```bash
npm audit fix
```

After this command completes, re-run `npm audit` to assess the remaining vulnerabilities.

### Step 2: Interactive Dependency Updates

For the remaining vulnerabilities, and for general dependency health, we will use the `npm-check-updates` package. This tool provides an interactive interface to update `package.json` with the latest versions.

1.  **Install `npm-check-updates` globally (if not already installed):**
    ```bash
    npm install -g npm-check-updates
    ```

2.  **Run the interactive update process:**
    ```bash
    ncu -i
    ```
    This will present a list of all outdated dependencies. You should select all of them for update, unless there is a specific, known compatibility issue with a newer version.

### Step 3: Install Updated Dependencies

After `ncu` has updated your `package.json`, you'll need to install the new versions.

```bash
npm install
```

### Step 4: Address `npm audit fix --force` Issues

It's possible that some vulnerabilities will still remain, and the `npm audit` report may suggest using `npm audit fix --force`. This can introduce breaking changes, so we will handle these on a case-by-case basis.

For each remaining vulnerability:
1.  Read the `npm audit` report to understand the nature of the vulnerability and the proposed fix.
2.  If the fix involves a major version bump, consult the dependency's changelog or release notes to understand the breaking changes.
3.  Apply the fix: `npm install <package>@<latest-version>`
4.  Run the verification gates (`npm run build`, `npm run test`) to ensure the update has not broken anything.

### Step 5: Final Verification

Once all updates are complete, run the full suite of verification gates to confirm that the application is in a good state.

```bash
npm audit
npm run build
npm run test
```

## 4. Out of Scope

*   This plan does not cover the introduction of new features or refactoring of existing code.
*   This plan does not address the addition of new tests, only the verification that existing tests still pass.
*   Any breaking changes introduced by dependency updates will be addressed only to the extent required to get the verification gates to pass. Major refactoring to adopt new APIs will be deferred to a separate plan.

## 5. STOP Conditions

*   If, after updating a dependency, the `npm run build` or `npm run test` commands fail and the issue cannot be resolved within a reasonable amount of time (e.g., 15-20 minutes), stop and report the issue. The dependency may need to be downgraded to a slightly older, but still secure, version.
*   If `npm audit fix --force` introduces a cascade of failures that cannot be easily resolved, stop and report the situation. A more detailed, manual dependency update plan may be required.
