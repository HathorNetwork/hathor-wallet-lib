{
  description = "Hathor wallet-lib's virtual environments";

  inputs.devshell.url = "github:numtide/devshell";
  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs = { flake-utils, devshell, nixpkgs, ... }:

    flake-utils.lib.eachDefaultSystem (system: {
      devShell =
        let pkgs = import nixpkgs {
          inherit system;

          overlays = [ devshell.overlays.default ];
        };
        in
        pkgs.devshell.mkShell {
          commands = [
            {
              category = "tests";
              name = "unit_tests";
              help = "Run unit tests";
              command = "npm run test";
            }
            {
              category = "build";
              name = "build";
              help = "Build wallet-lib";
              command = "npm run build";
            }
            {
              category = "check";
              name = "lint_check";
              help = "Run lint checker";
              command = "npm run lint";
            }
            {
              category = "check";
              name = "lint_fix";
              help = "Run lint and fix if possible";
              command = "npm run lint:fix";
            }
            {
              category = "tests";
              name = "integration_up";
              help = "Start integration tests infra";
              command = "npm run test_network_up";
            }
            {
              category = "tests";
              name = "integration_down";
              help = "Cleanup integration tests infra";
              command = "npm run test_network_down";
            }
            {
              category = "tests";
              name = "integration_tests";
              help = "Run integration tests (network should be running)";
              command = "npm run test_network_integration";
            }
          ];
          packages = with pkgs; [
            nixpkgs-fmt
            nodejs_22
          ];
        };
    });
}
