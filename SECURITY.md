# Security policy

DPI-H Lab is used in workshops with government and partner organisations, so we take security reports seriously.

## Reporting a vulnerability

**Please don't report security problems in public issues, discussions or pull requests.**

Report them privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/sscproject/dpi-h-lab/security/advisories/new)). Only the maintainers can see the report.

Please include:

- what the problem is and where (file, route or screen)
- steps to reproduce it, or a proof of concept
- what an attacker could do with it

We aim to acknowledge reports within 5 working days, agree a fix and a disclosure date with you, and credit you in the advisory if you wish.

## Supported versions

Security fixes go into `main`, which is what the public deployment runs. There are no separately maintained older releases.

## Scope

In scope: this repository's code, configuration and default deployment files.

Out of scope: denial-of-service by volume, findings from automated scanners without a demonstrated impact, and problems in third-party services or in someone else's deployment of this code.

## Please don't

- access, change or delete data that isn't yours, including other teams' worksheets on the public site
- test against workshops in progress
- run automated scans against the public site
