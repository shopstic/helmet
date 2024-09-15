{
  description = "Type-safe Helm";

  inputs = {
    # hotPot.url = "github:shopstic/nix-hot-pot";
    hotPot.url = "git+file:/Users/nktpro/Dev/shopstic/nix-hot-pot";
    nixpkgs.follows = "hotPot/nixpkgs";
    flakeUtils.follows = "hotPot/flakeUtils";
    npmlock2nix = {
      url = "github:nix-community/npmlock2nix/master";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flakeUtils, hotPot, npmlock2nix }:
    flakeUtils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ]
      (system:
        let
          pkgs = import nixpkgs
            {
              inherit system;
            };
          hotPotPkgs = hotPot.packages.${system};
          hotPotLib = hotPot.lib.${system};
          json2ts = pkgs.callPackage ./nix/json2ts {
            npmlock2nix = (import npmlock2nix { inherit pkgs; }).v2;
            nodejs = pkgs.nodejs_20;
          };
          deno = hotPotPkgs.deno;
          runtimeInputs = builtins.attrValues
            {
              inherit json2ts;
              inherit (hotPotPkgs)
                kubernetes-helm;
              inherit (pkgs)
                kubectl
                yq-go
                sops
                ;
            };
          helmet =
            let
              name = "helmet";
              src = builtins.path
                {
                  path = ./.;
                  name = "${name}-src";
                  filter = with pkgs.lib; (path: /* type */_:
                    hasInfix "/src" path ||
                    hasSuffix "/deno.json" path ||
                    hasSuffix "/deno.lock" path
                  );
                };
              deno-cache-dir = pkgs.callPackage hotPotLib.denoAppCache2 {
                inherit name src;
                lock-file = ./deno.lock;
                config-file = ./deno.json;
              };
              transpiled = pkgs.callPackage hotPotLib.denoAppTranspile
                {
                  inherit name deno-cache-dir src;
                  appSrcPath = "./src/helmet.ts";
                  denoRunFlags = ''"''${DENO_RUN_FLAGS[@]}"'';
                  preExec = ''
                    DENO_RUN_FLAGS=("-A")
                    if [ ! -f deno.lock ]; then
                      DENO_RUN_FLAGS+=("--no-lock")
                    fi
                    if [ -f deno.json ]; then
                      DENO_RUN_FLAGS+=("--config=deno.json")
                    elif [ -f deno.jsonc ]; then
                      DENO_RUN_FLAGS+=("--config=deno.jsonc")
                    fi
                  '';
                  allowNpmSpecifiers = true;
                };
              denoJson = builtins.fromJSON (builtins.readFile ./deno.json);
            in
            pkgs.runCommandLocal "${name}-wrapped"
              {
                buildInputs = [ pkgs.makeWrapper ];
              }
              ''
                makeWrapper ${transpiled}/bin/helmet $out/bin/helmet \
                  --set HELMET_VERSION "${denoJson.version}" \
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
                    nodejs_20
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
            inherit json2ts helmet;
            devEnv = devShell.inputDerivation;
          };
          defaultPackage = packages.helmet;
        }
      );
}
