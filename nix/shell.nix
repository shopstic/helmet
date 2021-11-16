{ pkgs, hotPot }:
let
  nodePkgs = import ./node2nix-default.nix { pkgs = pkgs; };
in
rec {
  runtimeInputs = builtins.attrValues
    {
      inherit (pkgs)
        kubectl
        yq-go
        sops
        kubernetes-helm
        ;
    } ++ [
    hotPot.deno
    nodePkgs."json-schema-to-typescript-10.1.5"
  ];
  derivation = pkgs.mkShellNoCC {
    buildInputs = [
      pkgs.nodePackages.node2nix
    ] ++ runtimeInputs;
  };
}
