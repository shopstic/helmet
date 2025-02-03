{
  description = "Type-safe Helm";

  inputs = {
    hotPot.url = "github:shopstic/nix-hot-pot";
    nixpkgs.follows = "hotPot/nixpkgs";
    flakeUtils.follows = "hotPot/flakeUtils";
  };

  outputs = { self, nixpkgs, flakeUtils, hotPot }:
    flakeUtils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ]
      (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [
              (self: super: {
                nodejs-16_x = super.nodejs-18_x;
              })
            ];
          };
          hotPotPkgs = hotPot.packages.${system};
          deno = hotPotPkgs.deno;
          runtimeInputs = builtins.attrValues
            {
              inherit (hotPotPkgs)
                kubernetes-helm;
              inherit (pkgs)
                kubectl
                sops
                gnutar
                coreutils
                ;
            };
          denoJson = builtins.fromJSON (builtins.readFile ./deno.json);
          src = builtins.path
            {
              path = ./.;
              name = "helmet-src";
              filter = with pkgs.lib; (path: /* type */_:
                hasInfix "/src" path ||
                hasSuffix "/deno.lock" path ||
                hasSuffix "/deno.json" path
              );
            };
          unmapped-src = pkgs.runCommandLocal "unmapped-src"
            {
              buildInputs = [ hotPotPkgs.deno-ship ];
            }
            ''
              cp -r --reflink=auto ${src} $out
              chmod -R +w $out
              deno-ship unmap-specifiers --src-dir "$out" --import-map "$out/deno.json"
            '';
          helmet-bin = pkgs.writeShellScript "helmet" ''
              DENO_RUN_FLAGS=("-A")
              if [ ! -f deno.lock ]; then
                DENO_RUN_FLAGS+=("--no-lock")
              fi
              if [ -f deno.json ]; then
                DENO_RUN_FLAGS+=("--config=deno.json")
              elif [ -f deno.jsonc ]; then
                DENO_RUN_FLAGS+=("--config=deno.jsonc")
              fi

              ${(if denoJson.version == "*" then ''
              deno run "''${DENO_RUN_FLAGS[@]}" ${unmapped-src}/src/cli.ts "$@"
            '' else ''
              deno run "''${DENO_RUN_FLAGS[@]}" jsr:${denoJson.name}@${denoJson.version}/cli "$@"
            '')}
          '';
          helmet = pkgs.runCommandLocal "helmet"
            {
              buildInputs = [ pkgs.makeWrapper ];
            }
            ''
              makeWrapper ${helmet-bin} $out/bin/helmet \
                --prefix PATH : "${pkgs.lib.makeBinPath runtimeInputs}"
            '';
          vscodeSettings = pkgs.writeTextFile {
            name = "vscode-settings.json";
            text = builtins.toJSON {
              "deno.enable" = true;
              "deno.lint" = true;
              "deno.unstable" = true;
              "deno.path" = deno + "/bin/deno";
              "deno.suggest.imports.hosts" = {
                "https://deno.land" = false;
              };
              "editor.tabSize" = 2;
              "[typescript]" = {
                "editor.defaultFormatter" = "denoland.vscode-deno";
                "editor.formatOnSave" = true;
                "editor.inlayHints.enabled" = "offUnlessPressed";
              };
              "yaml.schemaStore.enable" = true;
              "yaml.schemas" = {
                "https://json.schemastore.org/github-workflow.json" = ".github/workflows/*.yaml";
              };
              "nix.enableLanguageServer" = true;
              "nix.formatterPath" = pkgs.nixpkgs-fmt + "/bin/nixpkgs-fmt";
              "[nix]" = {
                "editor.defaultFormatter" = "jnoortheen.nix-ide";
              };
              "nix.serverSettings" = {
                "nil" = {
                  "formatting" = {
                    "command" = [ "nixpkgs-fmt" ];
                  };
                };
              };
              "nix.serverPath" = pkgs.nil + "/bin/nil";
            };
          };
        in
        rec {
          devShell = pkgs.mkShellNoCC
            {
              buildInputs = runtimeInputs ++ builtins.attrValues
                {
                  inherit deno;
                  inherit (pkgs)
                    gh
                    nodejs_22
                    jq
                    ;
                  inherit (hotPotPkgs)
                    typescript-eslint
                    ;
                };
              shellHook = ''
                mkdir -p ./.vscode
                cat ${ vscodeSettings} > ./.vscode/settings.json
              '';
            };
          packages = {
            inherit helmet unmapped-src helmet-bin;
            devEnv = devShell.inputDerivation;
          };
          defaultPackage = packages.helmet;
        }
      );
}
