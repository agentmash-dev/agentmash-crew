#!/usr/bin/env bash
# Seeds a small but realistic full-stack repo ("teamspace") so routing cases have code to delegate on.
set -euo pipefail
git init -q -b main
git config user.email eval@example.com && git config user.name eval
mkdir -p src/server/routes src/server/middleware src/server/services src/web/components src/web/pages src/web/styles \
  src/integrations/stripe src/integrations/twilio src/billing mobile/src/screens mobile/src/navigation \
  prisma/migrations/0001_init ml prompts locales/en tests/e2e docs .github/workflows .agentmash-crew/plans .agentmash-crew/approvals
cat > package.json <<'EOF'
{ "name": "teamspace", "version": "0.4.0", "private": true,
  "scripts": { "dev": "tsx watch src/server/app.ts", "build": "tsc -p .", "typecheck": "tsc --noEmit", "lint": "eslint src", "test": "vitest run", "e2e": "playwright test" },
  "dependencies": { "express": "^4.19.2", "@prisma/client": "^5.14.0", "stripe": "^15.8.0", "twilio": "^5.1.0", "zod": "^3.23.8", "react": "^18.3.1" },
  "devDependencies": { "typescript": "^5.4.5", "vitest": "^1.6.0", "@playwright/test": "^1.44.0", "prisma": "^5.14.0", "tsx": "^4.11.0" } }
EOF
cat > README.md <<'EOF'
# teamspace
Workspaces, members and billing. Server: Express + Prisma (src/server). Web: React (src/web). Mobile: React Native (mobile/). ML churn model: ml/.
Run `npm run dev`, tests with `npm test`, e2e with `npm run e2e`.
EOF
echo "# Changelog" > CHANGELOG.md
cat > src/server/app.ts <<'EOF'
import express from "express";
import { requireAuth } from "./middleware/auth";
import { usersRouter } from "./routes/users";
export const app = express();
app.use(express.json());
app.use("/api/users", requireAuth, usersRouter);
EOF
cat > src/server/middleware/auth.ts <<'EOF'
import type { Request, Response, NextFunction } from "express";
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).session?.user;
  if (!user) return res.status(401).json({ error: "unauthenticated" });
  (req as any).user = user; next();
}
EOF
cat > src/server/routes/users.ts <<'EOF'
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../services/db";
export const usersRouter = Router();
const Patch = z.object({ fullname: z.string().min(1).max(80) }).strict();
usersRouter.patch("/:id", async (req, res) => {
  const body = Patch.safeParse(req.body);
  if (!body.success) return res.status(422).json({ error: "invalid", issues: body.error.issues });
  const user = await prisma.user.update({ where: { id: req.params.id }, data: body.data });
  res.json(user);
});
EOF
echo 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();' > src/server/services/db.ts
cat > src/server/cart.ts <<'EOF'
export interface Line { sku: string; qty: number; price: { amount: number; currency: string } }
export function cartTotal(lines: Line[]) {
  const currency = lines[0].price.currency;
  return { amount: lines.reduce((s, l) => s + l.qty * l.price.amount, 0), currency };
}
export function applyDiscount(total: number, code?: { percent: number }) { return code ? total : total; }
EOF
cat > src/server/cart.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
import { cartTotal, applyDiscount } from "./cart";
describe("cart", () => {
  it("totals an empty cart", () => { expect(cartTotal([]).amount).toBe(0); });
  it("applies a discount code", () => { expect(applyDiscount(100, { percent: 10 })).toBe(90); });
});
EOF
cat > src/web/styles/tokens.css <<'EOF'
:root { --color-bg: #0b0b0c; --color-fg: #f2f2ee; --color-accent: #f97316; --space-2: 8px; --space-4: 16px; --radius-md: 10px; }
EOF
cat > src/web/components/Button.tsx <<'EOF'
export function Button({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button className="btn" onClick={onClick} disabled={disabled}>{children}</button>;
}
EOF
cat > src/web/pages/Checkout.tsx <<'EOF'
export function Checkout({ count }: { count: number }) {
  return (<main><h1>Checkout</h1><p>You have {count} items in your cart</p><button>Pay now</button></main>);
}
EOF
echo '{ "checkout.title": "Checkout" }' > locales/en/checkout.json
cat > src/integrations/stripe/client.ts <<'EOF'
import Stripe from "stripe";
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", { apiVersion: "2024-04-10" });
EOF
cat > src/integrations/twilio/sms.ts <<'EOF'
import twilio from "twilio";
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
export async function sendSms(to: string, body: string) { return client.messages.create({ to, from: process.env.TWILIO_FROM, body }); }
EOF
for f in invoice receipt credit-note; do cat > "src/billing/format-$f.ts" <<EOF
export function format${f//-/_}(amount: number, currency: string) { const v = (amount / 100).toFixed(2); return currency === "USD" ? "\$" + v : v + " " + currency; }
EOF
done
python3 - <<'EOF'
lines = ["// grab-bag of helpers used across billing"] + [f"export function helper{i}(x: number) {{ return x * {i} + {i % 7}; }}" for i in range(900)]
open("src/billing/utils.ts", "w").write("\n".join(lines) + "\n")
EOF
cat > mobile/app.json <<'EOF'
{ "expo": { "name": "teamspace", "slug": "teamspace", "version": "0.4.0", "android": { "softwareKeyboardLayoutMode": "pan" } } }
EOF
cat > mobile/src/screens/LoginScreen.tsx <<'EOF'
import { View, TextInput, Button } from "react-native";
export function LoginScreen() { return (<View style={{ flex: 1, justifyContent: "flex-end", padding: 16 }}><TextInput placeholder="Email" /><TextInput placeholder="Password" secureTextEntry /><Button title="Sign in" onPress={() => {}} /></View>); }
EOF
cat > mobile/src/screens/ProfileScreen.tsx <<'EOF'
import { View, Image } from "react-native";
export function ProfileScreen({ uri }: { uri: string }) { return (<View><Image source={{ uri }} style={{ width: "100%", height: 120 }} /></View>); }
EOF
echo 'export const RootNavigator = () => null; // stack: Login -> Home -> Profile' > mobile/src/navigation/RootNavigator.tsx
cat > prisma/schema.prisma <<'EOF'
datasource db { provider = "postgresql" url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }
model User { id String @id @default(cuid()) email String @unique fullname String createdAt DateTime @default(now()) }
model Workspace { id String @id @default(cuid()) name String }
EOF
echo 'CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "email" TEXT UNIQUE NOT NULL, "fullname" TEXT NOT NULL);' > prisma/migrations/0001_init/migration.sql
cat > ml/features.py <<'EOF'
import pandas as pd
def build_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df[["seats", "plan_price", "tickets_30d"]].copy()
    out["last_login_days"] = (df["churned_at"].fillna(pd.Timestamp.now()) - df["last_login_at"]).dt.days
    return out
EOF
cat > ml/train.py <<'EOF'
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
def train(X, y):
    X = StandardScaler().fit_transform(X)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2)
    m = LogisticRegression(max_iter=500).fit(Xtr, ytr)
    return m, roc_auc_score(yte, m.predict_proba(Xte)[:, 1])
EOF
cat > prompts/summarize.md <<'EOF'
Summarize the conversation for the account manager. Be concise. Return JSON with keys summary and action_items.
EOF
cat > tests/e2e/playwright.config.ts <<'EOF'
import { defineConfig } from "@playwright/test"; export default defineConfig({ testDir: ".", use: { baseURL: "http://localhost:3000" } });
EOF
cat > .github/workflows/ci.yml <<'EOF'
name: ci
on: [push, pull_request]
jobs:
  lint: { runs-on: ubuntu-latest, steps: [ { uses: actions/checkout@v4 }, { uses: actions/setup-node@v4, with: { node-version: 20 } }, { run: npm install }, { run: npm run lint } ] }
  test: { runs-on: ubuntu-latest, steps: [ { uses: actions/checkout@v4 }, { uses: actions/setup-node@v4, with: { node-version: 20 } }, { run: npm install }, { run: npm test } ] }
  e2e:  { runs-on: ubuntu-latest, steps: [ { uses: actions/checkout@v4 }, { uses: actions/setup-node@v4, with: { node-version: 20 } }, { run: npm install }, { run: npx playwright install --with-deps }, { run: npm run e2e } ] }
EOF
echo "# Admin guide" > docs/admin.md
cat > .agentmash-crew/plans/invite-links.md <<'EOF'
# Plan · invite-links
Status: approved by the human (see approvals/invite-links.md)
## Units
| id | owner | ownership | depends_on | verify |
|---|---|---|---|---|
| U1 | index-database | prisma/schema.prisma, prisma/migrations/** | - | npx prisma migrate diff |
| U2 | pipe-backend | src/server/routes/invites.ts, src/server/services/invites.ts | U1 | npm test -- invites |
| U3 | flex-frontend | src/web/pages/InviteSettings.tsx | U2 | npm run typecheck |
| U4 | quill-docs | docs/admin.md | U2 | ls docs/admin.md |
## Contracts
POST /api/invites { email } -> 201 { id, expiresAt }; GET /api/invites/:token -> 200 { workspaceId }
## Waves
1: U1 · 2: U2 · 3: U3, U4
EOF
printf '%s\n' "Plan: .agentmash-crew/plans/invite-links.md" "The human approved the plan on 2026-09-26: 'Approved, go ahead with all four units.'" "Gates granted: none (the plan crosses no approval gate)." > .agentmash-crew/approvals/invite-links.md
echo ".agentmash-crew/" >> .git/info/exclude
# The manifest of a named team, as `team add "Команда 123" --agents pipe,flex,probe` records it. Eval runs load no
# project skills or agents, so the team skill comes from the fixture plugin in team-plugin/ (listed in case.yaml)
# and the agents from the crew plugin.
mkdir -p .claude/agentmash-crew
cat > .claude/agentmash-crew/teams.json <<'TEAMS_JSON'
{
  "schema": 1,
  "source": {
    "name": "agentmash-crew",
    "version": "1.1.0",
    "url": "https://github.com/agentmash-dev/agentmash-crew"
  },
  "createdSettings": false,
  "teams": [
    {
      "slug": "komanda-123",
      "name": "Команда 123",
      "members": [
        "mash-coordinator",
        "flex-frontend",
        "pipe-backend",
        "probe-qa"
      ]
    }
  ],
  "files": {}
}
TEAMS_JSON
git add -A && git commit -qm "chore: seed teamspace"
