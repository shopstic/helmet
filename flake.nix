{
  description = "Type-safe Helm";

  inputs = {
    flakeUtils = {
      url = "github:numtide/flake-utils";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nixHotPot = {
      url = "github:shopstic/nix-hot-pot";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flakeUtils.follows = "flakeUtils";
    };
  };

  outputs = { self, nixpkgs, flakeUtils, nixHotPot }:
    let version = if (self ? rev) then self.rev else "latest"; in
    flakeUtils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ]
      (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          hotPot = nixHotPot.packages.${system};
          shell = (import ./nix/shell.nix { inherit pkgs hotPot; });
          helmetSrc = builtins.path
              {
                path = ./.;
                name = "helmet-src";
                filter = with pkgs.lib; (path: type:
                  hasInfix "/src" path ||
                  hasSuffix "/cli.sh" path ||
                  hasSuffix "/lock.json" path
                );
              };
          denoDir = pkgs.stdenv.mkDerivation {
            name = "helmet-deno-deps";
            src = helmetSrc;
            buildInputs = shell.derivation.buildInputs;
            __noChroot = true;
            installPhase = ''
              ls -la .
              export DENO_DIR="$out"
              patchShebangs ./cli.sh
              ./cli.sh update_cache
            '';
          };
        in
        rec {
          devShell = shell.derivation;
          packages = {
            devEnv = devShell.inputDerivation;
            helmet = pkgs.stdenv.mkDerivation {
              name = "helmet";
              src = helmetSrc;
              buildInputs = devShell.buildInputs ++ [ pkgs.makeWrapper ];
              buildPhase = ''
                export DENO_DIR="$TMPDIR/.deno"
                export DENO_INSTALL_ROOT="$out"
                mkdir -p "''${DENO_DIR}"
                mkdir -p "$out/bin"

                ln -s "${denoDir}/deps" "''${DENO_DIR}/deps"
                patchShebangs ./cli.sh

                ./cli.sh install "${version}" "$out/bin"
              '';
              installPhase = ''
                wrapProgram $out/bin/helmet --prefix PATH : "${pkgs.lib.makeBinPath shell.runtimeInputs}"
              '';
            };
          };
          defaultPackage = packages.helmet;
        }
      );
}
