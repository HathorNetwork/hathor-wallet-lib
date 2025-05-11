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
              category = "build";
              name = "lint_check";
              help = "Run lint checker";
              command = "npm run lint";
            }
            {
              category = "build";
              name = "lint_fix";
              help = "Run lint and fix if possible";
              command = "npm run lint:fix";
            }
          ];
          packages = with pkgs; [
            nixpkgs-fmt
            nodejs_22
          ];
        };
    });
}
