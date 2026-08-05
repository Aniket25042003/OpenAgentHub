# aniketpatel/echo-server

A reference OpenAgentHub agent with two interfaces:

- **CLI**: echoes JSON input with agent metadata (`openagenthub run aniketpatel/echo-server --model local`)
- **HTTP**: `python server.py` then `curl -X POST http://localhost:8080/echo -d '{"hello":"world"}'`

## Manifest highlights

- `interfaces.cli` + `interfaces.http` declared together
- `models.supported: [local]` — no API key required
- `permissions: [none]` and no `secrets` — the minimal safe baseline
