# Issue Drop

Append-only log for [issus.json](https://github.com/Vraigos/LogEndpoint/blob/main/issus.json). Messages can be added from this app or from any other app. They cannot be deleted here.

## JSON endpoint

`POST /api/json` with `Content-Type: application/json`

```json
{"text":"hello"}
```

`message` is accepted instead of `text`. The response:

```json
{"ok":true,"text":"hello","at":"2026-10-28T00:00:00.000Z","count":1,"file":"https://github.com/Vraigos/LogEndpoint/blob/main/issus.json"}
```

`GET /api/json` returns every saved message. `DELETE` is refused.

Set `GITHUB_TOKEN` in the server environment. The token is not stored in this repository. A fine-grained token that can only edit this repo is enough.
