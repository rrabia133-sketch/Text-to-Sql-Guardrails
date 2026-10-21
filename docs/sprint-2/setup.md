# Local Developer Setup & Clean-Checkout Guide

This guide provides step-by-step instructions to set up, build, and run the **Text-to-SQL Interface** workspace from a clean repository checkout.

---

## 1. Prerequisites

Before starting, ensure you have the following installed on your host machine:

| Prerequisite | Required Version | Verification Command |
|---|---|---|
| **Node.js** | `>= 22.0.0` (LTS) | `node --version` |
| **npm** | `>= 10.0.0` | `npm --version` |
| **Docker** | `>= 24.0.0` | `docker --version` |
| **Docker Compose** | `>= 2.20.0` | `docker compose version` |

> **OS Support:** Windows (PowerShell / Command Prompt), macOS, and Linux.

---

## 2. Step-by-Step Setup from a Clean Clone

### Step 2.1: Clone the Repository
```bash
git clone <repo-url>
cd Text-to-SQL-Interface
