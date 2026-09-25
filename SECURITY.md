# Security Policy

## Supported version

Security fixes are made against the latest App Store and Google Play release of IronVault.

## Reporting a vulnerability

Please report suspected security or privacy issues privately by emailing
`ironvault.app@gmail.com`. Do not open a public GitHub issue for a vulnerability.

Include the affected feature, clear reproduction steps, and the potential impact.
Please do not include passwords, authentication tokens, workout exports, or other
people's personal data. You should receive an acknowledgement within seven days.

## Public configuration

IronVault's Firebase client configuration identifies the Firebase project and is
intentionally included in the app. Access to private data is controlled by Firebase
Authentication and Security Rules, not by treating client configuration as a secret.

## Dependency audit exception

The automated dependency audit currently permits only two known denial-of-service
advisories in Metro's transitive `image-size` build dependency:
`GHSA-5p2g-fcmc-qvqq` and `GHSA-w3rx-r6r6-pgpr`. IronVault does not use this package
at runtime or process untrusted build assets. The exception should be removed when
Expo SDK 54 provides a compatible patched dependency.

Firebase Storage is not enabled or used by IronVault. If Storage is introduced in
the future, its deny-by-default rules must be wired into `firebase.json`, tested in
the emulator, and deployed before any client code is released.
