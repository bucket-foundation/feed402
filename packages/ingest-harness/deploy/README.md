# Deploying feed402 at feed402.agfarms.dev

Single subdomain on the existing AGFarms cert + DNS. All providers live under
`/p/<provider>/`. No new domain needed.

## Path A — Docker Compose (single VM)

For the Hetzner CPX42 box that already runs Caddy + the x402 gateway.

```bash
cd packages/ingest-harness/deploy
cat > .env <<EOF
FEED402_FACILITATOR_URL=https://x402-research.agfarms.dev/x402
EOF
docker compose up -d --build
```

DNS prereq: a CNAME `feed402.agfarms.dev → <box>` in Cloudflare (or A/AAAA).
Caddy auto-issues the cert via HTTP-01 on port 80.

Verify:
```bash
curl https://feed402.agfarms.dev/                                      # provider index
curl https://feed402.agfarms.dev/health/global                         # combined health
curl https://feed402.agfarms.dev/p/world-history/.well-known/feed402.json
curl https://feed402.agfarms.dev/p/world-history/query?bbox=-15,35,40,60&limit=5  # 402
```

## Path B — K3s (AGFarms standard)

```bash
cd packages/ingest-harness
docker buildx build -t farmera/feed402-ingest-harness:0.1.0 --push .

kubectl apply -f deploy/k8s.yaml

# optional: wire to the gateway facilitator
kubectl create secret generic feed402-secrets \
  --namespace feed402 \
  --from-literal=facilitator_url=https://x402-research.agfarms.dev/x402
```

cert-manager issues `feed402-agfarms-tls` via the same `letsencrypt-prod`
ClusterIssuer the rest of `*.agfarms.dev` uses.

## What you get

- `https://feed402.agfarms.dev/` — JSON index of every provider.
- `https://feed402.agfarms.dev/p/<provider>/.well-known/feed402.json` — manifest.
- `https://feed402.agfarms.dev/p/<provider>/raw|query|insight` — paid tiers.

11 providers ship by default: pharma-fda, world-history, us-history,
constitutions, math-history, physics-history, medical-history, banking-history,
world-politics, banking, per-nation. **47,437 rows total.**

## Payment modes

`FEED402_FACILITATOR_URL=` (unset) → `stub` verifier (any base64 `{tx}` accepted).
`FEED402_FACILITATOR_URL=https://...` → POSTs `X-PAYMENT` header to `<url>/verify`.

## Cost

CPU < 200m steady state, RAM ~150MB at boot for all 11 providers. Fits
alongside existing AGFarms workloads.

## Rollback

```bash
docker compose down                # path A
kubectl delete -f deploy/k8s.yaml  # path B
```
