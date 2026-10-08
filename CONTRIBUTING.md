# Contributing

## Publishing

The `.github/workflows/publish.yml` workflow publishes the extension when a `v*` tag is pushed. It needs two repo secrets. Set them up once.

### VS Code Marketplace (VSCE_PAT)

Full guide: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

1. Sign in to Azure DevOps at https://dev.azure.com with a Microsoft account. Create an organization when prompted.
2. Open User settings, then Personal access tokens. Create a token with:
   - Organization: All accessible organizations.
   - Scope: Marketplace, Manage (custom defined).
   PAT guide: https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate
3. Sign in to the Marketplace manage page with the same account and create the publisher `simd-labs`.
4. Store the token as the repo secret: `gh secret set VSCE_PAT`.

### Open VSX (OVSX_PAT)

1. Create an Eclipse account from https://open-vsx.org (Register).
2. Sign the Eclipse Contributor Agreement at https://www.eclipse.org/legal/ECA.php.
3. Sign in to https://open-vsx.org with GitHub. Open Settings, then Access Tokens, and generate a token: https://open-vsx.org/user-settings/tokens
4. Open Namespaces and create the namespace `simd-labs`: https://open-vsx.org/user-settings/namespaces
5. Store the token as the repo secret: `gh secret set OVSX_PAT`.

### Publish a release

1. Bump `version` in package.json and commit.
2. Tag: `git tag v<version> && git push origin v<version>`.
3. Watch the workflow: `gh run watch`.
