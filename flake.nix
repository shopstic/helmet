{
  description = "Type-safe Helm";

  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs = { self, nixpkgs, flake-utils }:
    let version = if (self ? rev) then self.rev else "latest"; in
    flake-utils.lib.eachDefaultSystem
      (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          shell = (import ./nix/shell.nix { inherit pkgs; });
          denoDir = pkgs.stdenv.mkDerivation {
            name = "helmet-deno-deps";
            src = builtins.path { path = ./.; name = "helmet"; };
            buildInputs = shell.derivation.buildInputs;
            __noChroot = true;
            installPhase = ''
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
              src = builtins.path { path = ./.; name = "helmet"; };
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
