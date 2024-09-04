#!/bin/bash
#
# Script to release a new version of the wallet-lib in npm.
#

set -e  # Exit on any command failure.
set -u  # Exit on unset variables.

echo Environment:
echo - node $(node -v)
echo - npm $(npm -v)
echo - python $(python --version | awk '{print $2}')
echo

rm -rf node_modules/
rm -rf lib/

# We need to install the devDependencies to build the library, so the `--production` flag cannot be used.
#
# Additionally, the uploaded package does not include the `node_modules` folder, which means it's safe to keep the
# devDependencies installed. You can verify the files included in the package by running `npm publish --dry-run`.
npm ci
make build

# Finally, publish it!
npm publish
