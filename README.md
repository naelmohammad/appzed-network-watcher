# AppZed Network Watcher Agent

Tracks DNS answers and TLS certificate expiry per domain using public transparency APIs (DNS-over-HTTPS plus crt.sh). An hourly cron refreshes every watched domain. Schema self-initializes. No AI needed.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/naelmohammad/appzed-network-watcher)

Click **Deploy to Cloudflare**: it clones this repo to your GitHub account, provisions the bindings below on your Cloudflare account, and wires CI/CD with preview URLs on every PR.

## Bindings (auto-provisioned)

```jsonc
{
  "name": "appzed-network-watcher",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "appzed-network-watcher-meta"
    }
  ],
  "triggers": {
    "crons": ["0 * * * *"]
  }
}
```

## Try it

```bash
curl -X POST https://<your-worker>.workers.dev/domains \
  -H 'content-type: application/json' \
  -d '{"domain":"example.com"}'

curl https://<your-worker>.workers.dev/report
```

GET /health for a liveness check. Managed by AppZed (https://dev.appzed.com/solutions/network-watcher).
