{
  description = "Type-safe Helm";

  inputs = {
    hotPot.url = "github:shopstic/nix-hot-pot";
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
          json2ts = pkgs.callPackage ./nix/json2ts {
            npmlock2nix = (import npmlock2nix { inherit pkgs; }).v2;
            nodejs = pkgs.nodejs_20;
          };
          deno = hotPotPkgs.deno_1_41_x;
          runtimeInputs = builtins.attrValues
            {
              inherit json2ts deno;
              inherit (hotPotPkgs)
                kubernetes-helm;
              inherit (pkgs)
                kubectl
                yq-go
                sops
                nodejs_20
                ;
            };
          helmet = pkgs.callPackage hotPot.lib.denoAppBuild
            {
              inherit (hotPotPkgs) deno;
              denoRunFlags = "-A --check --no-lock";
              name = "helmet";
              src = builtins.path
                {
                  path = ./.;
                  name = "helmet-src";
                  filter = with pkgs.lib; (path: /* type */_:
                    hasInfix "/src" path ||
                    hasSuffix "/lock.json" path
                  );
                };
              appSrcPath = "./src/helmet.ts";
            };
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
              "nix.serverPath" = pkgs.rnix-lsp + "/bin/rnix-lsp";
              "[nix]" = {
                "editor.defaultFormatter" = "jnoortheen.nix-ide";
              };
            };
          };
        in
        rec {
          devShell = pkgs.mkShellNoCC {
            buildInputs = runtimeInputs ++ builtins.attrValues
              {
                inherit (pkgs)
                  gh
                  ;
              };
            shellHook = ''
              mkdir -p ./.vscode
              cat ${vscodeSettings} > ./.vscode/settings.json
            '';
          };
          packages = {
            inherit json2ts;
            devEnv = devShell.inputDerivation;
            helmet = pkgs.runCommandLocal "helmet-wrapped"
              {
                buildInputs = [ pkgs.makeWrapper ];
              }
              ''
                makeWrapper ${helmet}/bin/helmet $out/bin/helmet --prefix PATH : "${pkgs.lib.makeBinPath runtimeInputs}"
              '';
          };
          defaultPackage = packages.helmet;
        }
      );
}
