# PassBundle apps

The web vault, browser extension, and command line for [PassBundle](https://github.com/PimpinPumpkin/Passbundle), a password manager for individuals, families, and managed service providers (MSPs). The desktop and phone apps are in [passbundle-apps](https://github.com/PimpinPumpkin/passbundle-apps).

They're based on the open-source [Bitwarden clients](https://github.com/bitwarden/clients), which we follow by release and build in their open-source configuration only. PassBundle adds an MSP console (every client at a glance, staff and technician access, default policies, templates every client gets, onboarding through an RMM install command, and an audit log), custom roles for a client's point of contact, item templates, expiration dates, and autofill fixes. Vaults stay end-to-end encrypted: keys are made and used only in the apps.

> PassBundle is in development and not ready for production use.

## Building

```sh
npm ci
node brand/apply.mjs                                   # apply the PassBundle branding
(cd apps/web && npm run build:oss:selfhost:prod)       # web vault
(cd apps/browser && npm run build:prod:chrome)         # browser extension
node brand/apply.mjs --revert                          # back to the committed sources
```

Branding is applied at build time from [brand/brand.json](brand/brand.json). The end-to-end tests live in the [PassBundle repository](https://github.com/PimpinPumpkin/Passbundle); CI here runs them against each commit, together with the [PassBundle server](https://github.com/PimpinPumpkin/passbundle-server).

## Security

See [SECURITY.md](SECURITY.md).

## License and credits

GPL-3.0, see [LICENSE.txt](LICENSE.txt). Based on the Bitwarden clients by Bitwarden, Inc. and their contributors, whose copyright notices are kept.

PassBundle isn't affiliated with or endorsed by Bitwarden, Inc. Bitwarden is a trademark of Bitwarden, Inc.
