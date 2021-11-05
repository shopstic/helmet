{ pkgs ? import <nixpkgs> { } }:
with pkgs;
let
  nodePkgs = import ./node2nix-default.nix { pkgs = pkgs; };
  deno-bin = callPackage ./deno-bin.nix { };
in
rec {
  runtimeInputs = [
    deno-bin
    kubectl
    yq-go
    sops
    kubernetes-helm
    nodePkgs."json-schema-to-typescript-10.1.5"
  ];
  derivation = mkShell rec {
    buildInputs = [
      nodePackages.node2nix
    ] ++ runtimeInputs;
  };
}
