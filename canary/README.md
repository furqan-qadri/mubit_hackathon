# Canary project

This folder contains an independent copy of the Canary Labs analytics task and its labelled question batches. Responses are saved in `canary/results/`, and its batch runner checks only those results when deciding which questions have already been sent.

The company prompt, schema and `gpt-6-sol` settings match the original Dialect task. Mubit routes requests to the project associated with the API key.

The runner loads `canary/.env` when present, otherwise the repository's `.env`. Set `MUBIT_API_KEY` to the key for the intended project. Credentials are not copied into this folder or request logs.

From the repository root, preview the first ten questions:

```bash
node canary/send-mubit.mjs --from q_001 --count 10 --dry-run
```

Send them:

```bash
node canary/send-mubit.mjs --from q_001 --count 10
```

The batch runner skips matching completed calls in this folder and stops on a failure. Expected answers stay in the question files for separate evaluation; the requests contain only the fixed instructions and user question.
