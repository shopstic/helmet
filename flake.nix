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
            src = ./.;
            buildInputs = shell.derivation.buildInputs;
            __noChroot = true;
            installPhase = ''
              export DENO_DIR="$out"
              bash ./cli.sh update_cache
            '';
          };
        in
        rec {
          devShell = shell.derivation;
          packages = {
            devEnv = devShell.inputDerivation;
            helmet = pkgs.stdenv.mkDerivation {
              name = "helmet";
              src = ./.;
              buildInputs = devShell.buildInputs ++ [ pkgs.makeWrapper ];
              buildPhase = ''
                export DENO_DIR="$TMPDIR/.deno"
                mkdir -p "''${DENO_DIR}"
                ln -s "${denoDir}/deps" "''${DENO_DIR}/deps"
                ls -la "''${DENO_DIR}/deps"
                mkdir -p "$out/bin"
                bash ./cli.sh compile "${version}" "$out/bin"
              '';
              installPhase = ''
                wrapProgram $out/bin/helmet --set PATH ${pkgs.lib.makeBinPath shell.runtimeInputs}
              '';
            };
          };
          defaultPackage = packages.helmet;
        }
      );
}
