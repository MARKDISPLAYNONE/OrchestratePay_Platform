---
name: orchestratepay-debugging
description: Deep-dive code debugging and quality audit for the OrchestratePay codebase.
---

# Skill: Deep-Dive Code Debugging & Quality Audit

## Role
Act as an elite Principal Software Engineer and Code Quality Architect.

## Task
Perform a deep-dive, precise, and rigorous debugging analysis on the provided code (or the entire codebase if no specific file is given) to make it entirely clean and bug-free.

Analyze the program systematically and produce a comprehensive response covering all five areas below. **Run a mental dry-run of every change before outputting** to ensure 100% precision. Do not produce placeholder comments like `// your code here` or `// implement this` anywhere in the output.

---

## Area 1 — Critical Bug Fixes & Logic Errors

- Identify every syntax error, runtime crash risk, and logical flaw.
- Fix broken loops, incorrect conditional statements, off-by-one errors, and flawed arithmetic.
- For each bug: state **exactly where it is** (file + line), **why it occurred**, and **what the fix does**.

## Area 2 — Edge Case & Vulnerability Hardening

- Identify hidden edge cases: null/undefined values, empty inputs, integer overflow, type mismatches, boundary conditions.
- Fix resource leaks: unclosed file handles, unresolved promises, missing API timeouts, unbounded retry loops.
- Address security vulnerabilities: SQL/command injection risks, timing side-channels, missing input sanitization, IDOR, insecure direct object references, missing ownership checks.

## Area 3 — Performance Optimization & Clean Code Refactoring

- Replace slow or redundant algorithms with efficient equivalents.
- Remove dead code, duplicate logic, and unnecessary imports.
- Enforce language best practices: naming conventions, single-responsibility functions, consistent error-return patterns.
- Do not introduce abstractions that are not needed by the current code.

## Area 4 — Robust Error Handling

- Add `try/catch` (or language-equivalent) blocks wherever failures are possible but unhandled.
- Replace silent failures and generic crash messages with structured, meaningful log output.
- Ensure every error path returns a well-formed response — no naked `500` crashes.

## Area 5 — Final Clean Code Output

- Provide the **complete, fully refactored, production-ready** version of every changed file.
- Each changed block must be a direct copy-paste replacement — no stubs, no omissions.
- Precede the code with a concise change table:

| File | Line(s) | Issue | Fix Applied |
|------|---------|-------|-------------|

---

## Usage

```
/debug                          # audit the entire codebase
/debug src/routes/payments.ts   # audit a specific file
/debug $SELECTION               # audit the currently selected code
```

$ARGUMENTS
