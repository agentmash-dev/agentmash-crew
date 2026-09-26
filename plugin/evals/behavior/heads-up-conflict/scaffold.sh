#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
git config user.email eval@example.com && git config user.name eval
mkdir -p src/api
cat > package.json <<'EOF'
{ "name": "eval-app", "version": "1.0.0", "private": true, "scripts": { "test": "node --test" }, "dependencies": { "express": "^4.19.2" } }
EOF
cat > src/api/users.ts <<'EOF'
export interface User { id: string; email: string; displayName: string }

export async function updateUser(id: string, patch: Partial<User>): Promise<User> {
  // TODO: persist
  return { id, email: patch.email ?? "", displayName: patch.displayName ?? "" };
}
EOF
git add package.json src/api/users.ts && git commit -qm "chore: init"
