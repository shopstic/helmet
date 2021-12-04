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
    let version = if (self ? rev) then self.rev else "latest"; in
    flakeUtils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ]
      (system:
        let
          pkgs = import nixpkgs { inherit system; };
          hotPotPkgs = hotPot.packages.${system};
          json2ts = pkgs.callPackage ./nix/json2ts {
            npmlock2nix = import npmlock2nix { inherit pkgs; };
          };
          runtimeInputs = builtins.attrValues
            {
              inherit json2ts;
              inherit (pkgs)
                kubectl
                yq-go
                sops
                kubernetes-helm
                ;
              inherit (hotPotPkgs)
                deno
                ;
            };
          helmet = pkgs.callPackage hotPot.lib.denoAppBuild
            {
              inherit (hotPotPkgs) deno;
              denoRunFlags = "--unstable -A";
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
        in
        rec {
          devShell = pkgs.mkShellNoCC {
            buildInputs = runtimeInputs;
          };
          packages = {
            devEnv = devShell.inputDerivation;
            helmet = pkgs.runCommandNoCC "helmet-wrapped"
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
