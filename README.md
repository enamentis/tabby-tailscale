# Tabby Tailscale

An **unofficial** plugin for the [Tabby](https://tabby.sh) terminal. It is not made,
endorsed, or supported by Tailscale Inc.

It runs `tailscale status --json` and turns your Tailscale peers into SSH connection
profiles in Tabby's Profile Browser - refreshed every time the Profile Browser is
opened, so peers that come and go, get renamed, or get retagged are always reflected
without manual editing.

## Features

- Lists Tailscale peers (online and offline) as SSH profiles, host set to the peer's
  Tailscale DNS name (falls back to its IP).
- Filter/exclude peers by regex on hostname, tag, and/or online status.
- Assign peers to named **Groups**, each shown as its own visible, collapsible folder
  in the Profile Browser.
- Set a username, Vault-backed password override, and/or private key reference per
  rule or per group.
- Optional "only list tagged peers" toggle to hide untagged devices entirely.
- Optional "(offline)" suffix on offline peers' names (on by default, toggleable).
- Optional per-rule "show remaining tags in name" - appends whichever other tags a
  peer has (e.g. its deployment site) to its profile name, minus a
  configurable global exclude list. New tags show up automatically, no rule changes needed.
- Free-text `description` field per rule, purely for your own reference.
- No keyfile configured for a peer? Tabby falls back to the SSH agent, then an
  interactive password prompt with its own built-in "remember password" option.

Configure all of this from Tabby's Settings -> "Tailscale" tab - no manual
`config.yaml` editing required (though everything is stored there under a `tailscale:`
key, if you want to inspect, hand-edit it, or share it).

## How rules and groups resolve

Each peer is checked against your **Rules**, top to bottom. A rule matches if:

- its hostname regex matches the peer's Tailscale DNS label (e.g.
  `dev-playground-vm-1` - not the raw device hostname, since Tailscale's
  DNS label is what's actually guaranteed unique when multiple peers share a hostname),
  and/or
- its tag regex matches the peer's comma-joined tags, and/or
- its online-status filter (any / online only / offline only) matches the peer.

Hostname and tag matching are substring-based and case-insensitive (no need for
leading/trailing `.*`), and any blank condition is skipped rather than treated as
"must be empty".

For every matching rule, top to bottom, later rules override earlier ones for
whichever fields they explicitly set - **including `exclude`**. That means a broad
exclude rule near the top (or bottom) of the list can be selectively overridden by a
later, more specific rule that matches the same peer with "Exclude" left unchecked -
last matching rule wins, field by field, exactly like `group`/`user`/`password`/`private key`.

After all rules are evaluated (and the peer wasn't ultimately excluded), any field
still unset falls back to the resolved **Group**'s own defaults (if the peer was
assigned one), and finally to hardcoded defaults (`user: root`, no password, no private key).

So the priority is: **rule override > group default > hardcoded default**.

### Useful regex patterns

| Pattern | Matches |
|---|---|
| `prod` | contains "prod" |
| `^(?!.*prod)` | does **not** contain "prod" (negative lookahead) |
| `foo\|bar` | contains "foo" OR "bar" |
| `-\d+$` | ends with a dash and a number (Tailscale's disambiguating suffix for duplicate hostnames) |
| `^exact-name$` | matches only that exact hostname/DNS label |
| `^prefix` / `suffix$` | starts with / ends with |

These are also shown as a quick-reference tip directly under the Rules list in the
settings tab.

## Requirements

- The `tailscale` CLI must be installed and on `PATH` for the machine running Tabby.
- For key-based peers, make sure the corresponding public key is authorized on each
  peer. For everything else, Tabby's normal agent/password auth flow applies.
- Group/rule password overrides require Tabby's Vault to be enabled in
  **Settings -> Vault**. Stored passwords are never written to `config.yaml`
  in plaintext; the config only keeps an opaque vault marker.
- If you store private keys in the Vault and/or use Vault-backed password overrides,
  opening the Profile Browser may trigger a Vault unlock prompt. This plugin
  resolves matching groups/rules eagerly for every visible peer when the Profile
  Browser opens, rather than waiting until you connect.

## Building from source

```bash
npm install
npm run build
```

Output is written to `dist/index.js`. Copy `package.json` and `dist/` into tabby's plugin folder to test.

## License

MIT - see [LICENSE](LICENSE).
